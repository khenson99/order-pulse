#!/usr/bin/env python3
"""
Fetch HubSpot CRM data for Cognito customers only (using search API)
and build customer journey maps.
"""

import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from collections import defaultdict

API_TOKEN = os.environ.get("HUBSPOT_API_TOKEN", "")
BASE_URL = "https://api.hubapi.com"
COGNITO_CSV = os.path.join(os.path.dirname(__file__), "..", "server", "data", "cognito_users.csv")

STAGE_MAP = {
    "appointmentscheduled": "Prospect",
    "1499838171": "Approached",
    "qualifiedtobuy": "Lead",
    "presentationscheduled": "Demo Scheduled",
    "1955958510": "No-Show/Reschedule Demo",
    "decisionmakerboughtin": "Demo Follow-Up",
    "1955580622": "Budgetary quote sent",
    "1559099077": "Payment Link Sent",
    "1499827945": "Free Trial",
    "1731122907": "Freemium",
    "closedwon": "Closed Won",
    "contractsent": "Ping Later",
    "closedlost": "Closed Lost",
    "1499784890": "Churn",
    "1499784891": "Unlikely",
    "1499827944": "On Hold",
    "1718686448": "Internal+Friends and Family",
    "2025131723": "Interested in a pilot",
}

STAGE_ORDER = [
    "Prospect", "Approached", "Lead", "Demo Scheduled",
    "No-Show/Reschedule Demo", "Demo Follow-Up", "Budgetary quote sent",
    "Payment Link Sent", "Free Trial", "Freemium", "Interested in a pilot",
    "Closed Won", "Ping Later", "On Hold", "Closed Lost", "Churn",
    "Unlikely", "Internal+Friends and Family",
]


def hubspot_get(endpoint, params=None):
    url = f"{BASE_URL}{endpoint}"
    if params:
        query = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{url}?{query}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {API_TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"  HTTP Error {e.code}: {e.reason} for {url}", file=sys.stderr)
        return None


def hubspot_post(endpoint, body):
    url = f"{BASE_URL}{endpoint}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {API_TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        print(f"  HTTP Error {e.code}: {e.reason} - {body[:200]}", file=sys.stderr)
        return None


def search_contacts_by_emails(emails):
    """Search HubSpot contacts by email using the search API (batches of 3)."""
    all_contacts = {}
    # HubSpot search supports OR via multiple filterGroups (max 5)
    batch_size = 3  # keep under filterGroup limits
    email_list = list(emails)

    for i in range(0, len(email_list), batch_size):
        batch = email_list[i:i + batch_size]
        filter_groups = []
        for email in batch:
            filter_groups.append({
                "filters": [{
                    "propertyName": "email",
                    "operator": "EQ",
                    "value": email
                }]
            })

        body = {
            "filterGroups": filter_groups,
            "properties": [
                "email", "firstname", "lastname", "company", "lifecyclestage",
                "hs_lead_status", "createdate", "hs_analytics_source",
                "hs_analytics_source_data_1", "hs_analytics_source_data_2",
                "hs_analytics_first_timestamp", "hs_analytics_first_url",
                "hs_analytics_first_referrer", "hubspot_owner_id",
                "associatedcompanyid", "notes_last_updated",
                "hs_lifecyclestage_customer_date",
                "hs_lifecyclestage_opportunity_date",
                "hs_lifecyclestage_lead_date",
            ],
            "limit": 100,
        }

        result = hubspot_post("/crm/v3/objects/contacts/search", body)
        if result:
            for c in result.get("results", []):
                email = (c.get("properties", {}).get("email") or "").lower()
                if email:
                    all_contacts[email] = c
        time.sleep(0.15)

    return all_contacts


def search_deals_by_name(company_name):
    """Search deals that contain company name."""
    body = {
        "filterGroups": [{
            "filters": [{
                "propertyName": "dealname",
                "operator": "CONTAINS_TOKEN",
                "value": company_name.split()[0] if company_name else ""
            }]
        }],
        "properties": [
            "dealname", "dealstage", "pipeline", "amount", "closedate",
            "createdate", "hs_analytics_source", "hubspot_owner_id",
        ],
        "limit": 20,
    }
    result = hubspot_post("/crm/v3/objects/deals/search", body)
    if result:
        return result.get("results", [])
    return []


def fetch_all_deals():
    """Fetch all deals with pagination."""
    all_deals = []
    after = None
    props = "dealname,dealstage,pipeline,amount,closedate,createdate,hs_analytics_source,hubspot_owner_id"
    page = 0
    while True:
        page += 1
        params = {"limit": "100", "properties": props}
        if after:
            params["after"] = after
        data = hubspot_get("/crm/v3/objects/deals", params)
        if not data:
            break
        results = data.get("results", [])
        all_deals.extend(results)
        paging = data.get("paging", {})
        after = paging.get("next", {}).get("after")
        if not after:
            break
        time.sleep(0.15)
    print(f"  Fetched {len(all_deals)} total deals")
    return all_deals


def load_cognito_users():
    """Load Cognito users from CSV, filter out internal accounts."""
    users = []
    tenants = defaultdict(list)
    with open(COGNITO_CSV, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            email = row["Email"].strip()
            if email.endswith("@arda.cards") or email.endswith("@arda.com"):
                continue
            if "test" in email.lower() and "@" in email:
                if email.split("@")[0].lower().startswith("test"):
                    continue
            if email.startswith("customer-success+"):
                continue
            users.append(row)
            tenant = row.get("Tenant", "")
            if tenant and tenant != "None":
                tenants[tenant].append(row)
    return users, tenants


def format_date(iso_str):
    if not iso_str or iso_str == "N/A":
        return "N/A"
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%b %d, %Y")
    except:
        return iso_str[:10] if len(iso_str) >= 10 else iso_str


def days_between(d1, d2):
    """Compute days between two ISO date strings."""
    try:
        dt1 = datetime.fromisoformat(d1.replace("Z", "+00:00"))
        dt2 = datetime.fromisoformat(d2.replace("Z", "+00:00"))
        return abs((dt2 - dt1).days)
    except:
        return None


def main():
    print("=" * 80)
    print("ARDA CUSTOMER JOURNEY MAPPING")
    print("=" * 80)

    # 1. Load Cognito users
    print("\n[1/5] Loading Cognito users...")
    cognito_users, cognito_tenants = load_cognito_users()
    print(f"  {len(cognito_users)} external users across {len(cognito_tenants)} tenants")

    # Collect all emails to search
    all_emails = {u["Email"].strip().lower() for u in cognito_users}
    print(f"  {len(all_emails)} unique email addresses to look up")

    # 2. Search HubSpot for these specific contacts
    print("\n[2/5] Searching HubSpot for matching contacts...")
    hs_contacts = search_contacts_by_emails(all_emails)
    print(f"  Found {len(hs_contacts)} matching contacts in HubSpot")

    # 3. Fetch all deals (manageable count)
    print("\n[3/5] Fetching all deals...")
    all_deals = fetch_all_deals()

    # Index deals by name keywords for matching
    deal_index = defaultdict(list)
    for d in all_deals:
        dname = (d.get("properties", {}).get("dealname") or "").strip()
        # Index by first significant word and company part
        company_part = dname.rsplit(" - ", 1)[0].strip().lower() if " - " in dname else dname.lower()
        deal_index[company_part].append(d)
        for word in company_part.split():
            if len(word) > 3:
                deal_index[word].append(d)

    # 4. Build journey map per tenant (company)
    print("\n[4/5] Building journey maps...")

    journeys = []

    for tenant_id, users in sorted(cognito_tenants.items()):
        emails = [u["Email"].strip().lower() for u in users]

        # Find HubSpot contacts for this tenant
        tenant_hs_contacts = []
        company_name = None
        for email in emails:
            if email in hs_contacts:
                tenant_hs_contacts.append(hs_contacts[email])
                if not company_name:
                    company_name = hs_contacts[email].get("properties", {}).get("company")

        # Fall back to Cognito name
        if not company_name:
            for u in users:
                n = u.get("Name", "")
                if n and n != "None":
                    company_name = n
                    break
        if not company_name:
            # Derive from email domain
            for u in users:
                domain = u["Email"].split("@")[1] if "@" in u["Email"] else ""
                if domain and not domain.endswith("gmail.com") and not domain.endswith("icloud.com"):
                    company_name = domain.split(".")[0].title()
                    break

        if not company_name:
            company_name = f"Unknown ({emails[0] if emails else tenant_id[:8]})"

        # Find matching deals
        cn_lower = (company_name or "").lower()
        matching_deals = []
        seen_ids = set()

        # Exact match on company name
        if cn_lower in deal_index:
            for d in deal_index[cn_lower]:
                if d["id"] not in seen_ids:
                    seen_ids.add(d["id"])
                    matching_deals.append(d)

        # Keyword match
        if not matching_deals:
            for word in cn_lower.split():
                if len(word) > 3 and word in deal_index:
                    for d in deal_index[word]:
                        dname = (d.get("properties", {}).get("dealname") or "").lower()
                        # Verify relevance
                        if cn_lower in dname or any(w in dname for w in cn_lower.split() if len(w) > 3):
                            if d["id"] not in seen_ids:
                                seen_ids.add(d["id"])
                                matching_deals.append(d)

        # Determine first touch
        first_touch = None
        first_touch_source = None
        for hc in tenant_hs_contacts:
            ft = hc.get("properties", {}).get("hs_analytics_first_timestamp")
            if ft and (not first_touch or ft < first_touch):
                first_touch = ft
                first_touch_source = hc.get("properties", {}).get("hs_analytics_source")

        # Cognito signup (earliest)
        cognito_signup = None
        for u in users:
            cd = u.get("Created", "")
            if cd and (not cognito_signup or cd < cognito_signup):
                cognito_signup = cd

        # Analytics source
        source = first_touch_source or "Unknown"
        source_detail_1 = ""
        source_detail_2 = ""
        for hc in tenant_hs_contacts:
            s = hc.get("properties", {}).get("hs_analytics_source")
            if s:
                source = s
                source_detail_1 = hc.get("properties", {}).get("hs_analytics_source_data_1") or ""
                source_detail_2 = hc.get("properties", {}).get("hs_analytics_source_data_2") or ""
                break

        # Lifecycle stage
        lifecycle = "Unknown"
        for hc in tenant_hs_contacts:
            lc = hc.get("properties", {}).get("lifecyclestage")
            if lc:
                lifecycle = lc
                break

        # Best deal (prefer Closed Won, then latest active)
        best_deal = None
        for d in matching_deals:
            stage = STAGE_MAP.get(d["properties"].get("dealstage", ""), "Unknown")
            if stage == "Closed Won":
                best_deal = d
                break
        if not best_deal and matching_deals:
            # Prefer non-closed stages
            for d in matching_deals:
                stage = STAGE_MAP.get(d["properties"].get("dealstage", ""), "Unknown")
                if stage not in ("Unlikely", "Churn", "Closed Lost"):
                    best_deal = d
                    break
            if not best_deal:
                best_deal = matching_deals[0]

        deal_stage = None
        deal_amount = None
        deal_close_date = None
        deal_create_date = None
        if best_deal:
            dp = best_deal["properties"]
            deal_stage = STAGE_MAP.get(dp.get("dealstage", ""), dp.get("dealstage"))
            deal_amount = dp.get("amount")
            deal_close_date = dp.get("closedate")
            deal_create_date = dp.get("createdate")

        # Lifecycle stage dates
        customer_date = None
        opportunity_date = None
        lead_date = None
        for hc in tenant_hs_contacts:
            p = hc.get("properties", {})
            if p.get("hs_lifecyclestage_customer_date"):
                customer_date = p["hs_lifecyclestage_customer_date"]
            if p.get("hs_lifecyclestage_opportunity_date"):
                opportunity_date = p["hs_lifecyclestage_opportunity_date"]
            if p.get("hs_lifecyclestage_lead_date"):
                lead_date = p["hs_lifecyclestage_lead_date"]

        journey = {
            "company": company_name,
            "tenant_id": tenant_id,
            "first_touch": first_touch,
            "source": source,
            "source_detail": f"{source_detail_1} {source_detail_2}".strip(),
            "lifecycle_stage": lifecycle,
            "lead_date": lead_date,
            "opportunity_date": opportunity_date,
            "customer_date": customer_date,
            "cognito_signup": cognito_signup,
            "deal_stage": deal_stage,
            "deal_amount": deal_amount,
            "deal_create_date": deal_create_date,
            "deal_close_date": deal_close_date,
            "contacts": [
                {"email": u["Email"], "name": u.get("Name", "N/A"), "created": u.get("Created", "N/A")}
                for u in users
            ],
            "hs_contacts": [
                {
                    "email": hc["properties"].get("email"),
                    "name": f"{hc['properties'].get('firstname', '')} {hc['properties'].get('lastname', '')}".strip(),
                    "lifecycle": hc["properties"].get("lifecyclestage"),
                    "first_touch": hc["properties"].get("hs_analytics_first_timestamp"),
                    "source": hc["properties"].get("hs_analytics_source"),
                }
                for hc in tenant_hs_contacts
            ],
            "all_deals": [
                {
                    "name": d["properties"].get("dealname"),
                    "stage": STAGE_MAP.get(d["properties"].get("dealstage", ""), d["properties"].get("dealstage")),
                    "amount": d["properties"].get("amount"),
                    "created": d["properties"].get("createdate"),
                    "closed": d["properties"].get("closedate"),
                }
                for d in matching_deals
            ],
        }
        journeys.append(journey)

    # Sort by first touch, then cognito signup
    journeys.sort(key=lambda j: j.get("first_touch") or j.get("cognito_signup") or "9999")

    # 5. Output
    print(f"\n[5/5] Generating report for {len(journeys)} customer companies...\n")

    # Save JSON
    output_json = os.path.join(os.path.dirname(__file__), "..", "customer_journeys.json")
    with open(output_json, "w") as f:
        json.dump(journeys, f, indent=2, default=str)

    # Print detailed report
    print("=" * 80)
    print("CUSTOMER JOURNEY MAP — DETAILED REPORT")
    print("=" * 80)

    for idx, j in enumerate(journeys, 1):
        print(f"\n{'━' * 80}")
        print(f"  {idx}. {j['company'].upper()}")
        print(f"{'━' * 80}")

        # Build timeline events
        events = []
        if j["first_touch"]:
            events.append((j["first_touch"], "First Touch",
                           f"Source: {j['source']}" + (f" ({j['source_detail']})" if j['source_detail'] else "")))
        if j["lead_date"]:
            events.append((j["lead_date"], "Became Lead", "Lifecycle stage → Lead"))
        if j["deal_create_date"]:
            events.append((j["deal_create_date"], "Deal Created",
                           f"Stage: {j['deal_stage'] or 'N/A'}" + (f" | ${j['deal_amount']}" if j['deal_amount'] else "")))
        if j["opportunity_date"]:
            events.append((j["opportunity_date"], "Became Opportunity", "Lifecycle stage → Opportunity"))
        if j["cognito_signup"]:
            events.append((j["cognito_signup"], "Signed Up for Arda", "Created account on the platform"))
        if j["customer_date"]:
            events.append((j["customer_date"], "Became Customer", "Lifecycle stage → Customer"))
        if j["deal_close_date"]:
            events.append((j["deal_close_date"], "Deal Closed",
                           f"Result: {j['deal_stage'] or 'N/A'}" + (f" | ${j['deal_amount']}" if j['deal_amount'] else "")))

        events.sort(key=lambda e: e[0])

        if events:
            print(f"\n  JOURNEY TIMELINE:")
            for i, (date, label, detail) in enumerate(events):
                is_last = i == len(events) - 1
                connector = "└──" if is_last else "├──"
                line = "   " if is_last else "│  "
                print(f"    {connector} {format_date(date)}  {label}")
                print(f"    {line}                    {detail}")

            # Time from first touch to signup
            if j["first_touch"] and j["cognito_signup"]:
                days = days_between(j["first_touch"], j["cognito_signup"])
                if days is not None:
                    print(f"\n    ⏱  First Touch → Signup: {days} days")
            if j["first_touch"] and j["deal_close_date"]:
                days = days_between(j["first_touch"], j["deal_close_date"])
                if days is not None:
                    print(f"    ⏱  First Touch → Deal Close: {days} days")
        else:
            print(f"\n  JOURNEY TIMELINE: No HubSpot data found for this tenant")
            print(f"    Only Cognito signup: {format_date(j['cognito_signup'])}")

        print(f"\n  CURRENT STATUS:")
        print(f"    HubSpot Lifecycle: {j['lifecycle_stage']}")
        print(f"    Deal Stage:        {j['deal_stage'] or 'No deal found'}")

        print(f"\n  PEOPLE ({len(j['contacts'])}):")
        for c in j["contacts"]:
            print(f"    • {c['email']} — {c['name']} — joined {format_date(c['created'])}")

        if j["all_deals"]:
            print(f"\n  DEALS ({len(j['all_deals'])}):")
            for d in j["all_deals"]:
                print(f"    • {d['name']} → {d['stage']}" +
                      (f" | ${d['amount']}" if d['amount'] else "") +
                      (f" | closed {format_date(d['closed'])}" if d['closed'] else ""))

    # Aggregate stats
    print(f"\n\n{'=' * 80}")
    print("AGGREGATE STATISTICS")
    print(f"{'=' * 80}")

    stage_counts = defaultdict(int)
    source_counts = defaultdict(int)
    has_hs_data = 0
    total_days_to_signup = []

    for j in journeys:
        stage_counts[j["deal_stage"] or "No Deal"] += 1
        source_counts[j["source"]] += 1
        if j["first_touch"] or j["hs_contacts"]:
            has_hs_data += 1
        if j["first_touch"] and j["cognito_signup"]:
            days = days_between(j["first_touch"], j["cognito_signup"])
            if days is not None:
                total_days_to_signup.append(days)

    print(f"\n  Total customer companies (in Cognito): {len(journeys)}")
    print(f"  With HubSpot data:                     {has_hs_data}")
    print(f"  Without HubSpot data:                  {len(journeys) - has_hs_data}")

    print(f"\n  BY DEAL STAGE:")
    for stage in STAGE_ORDER + ["No Deal"]:
        if stage in stage_counts:
            bar = "█" * stage_counts[stage]
            print(f"    {stage:35s} {stage_counts[stage]:3d}  {bar}")

    print(f"\n  BY SOURCE:")
    for src, count in sorted(source_counts.items(), key=lambda x: -x[1]):
        bar = "█" * count
        print(f"    {src:35s} {count:3d}  {bar}")

    if total_days_to_signup:
        avg_days = sum(total_days_to_signup) / len(total_days_to_signup)
        min_days = min(total_days_to_signup)
        max_days = max(total_days_to_signup)
        print(f"\n  FIRST TOUCH → SIGNUP TIME:")
        print(f"    Average: {avg_days:.0f} days")
        print(f"    Min:     {min_days} days")
        print(f"    Max:     {max_days} days")

    print(f"\n  Report saved to: {output_json}")
    return journeys


if __name__ == "__main__":
    main()
