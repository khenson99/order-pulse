declare module 'amazon-paapi' {
  interface CommonParameters {
    AccessKey: string;
    SecretKey: string;
    PartnerTag: string;
    PartnerType: 'Associates';
    Marketplace: string;
  }

  interface GetItemsRequestParameters {
    ItemIds: string[];
    ItemIdType?: 'ASIN' | 'UPC' | 'EAN';
    Condition?: 'Any' | 'New' | 'Used' | 'Collectible' | 'Refurbished';
    Resources?: string[];
  }

  interface ItemResult {
    ASIN: string;
    DetailPageURL?: string;
    ItemInfo?: {
      Title?: {
        DisplayValue?: string;
      };
      ProductInfo?: {
        UnitCount?: {
          DisplayValue?: number;
        };
      };
      ExternalIds?: {
        UPCs?: {
          DisplayValues?: string[];
        };
      };
    };
    Images?: {
      Primary?: {
        Large?: {
          URL?: string;
        };
      };
    };
    Offers?: {
      Listings?: Array<{
        Price?: {
          DisplayAmount?: string;
          Amount?: number;
        };
      }>;
    };
  }

  interface GetItemsResponse {
    ItemsResult?: {
      Items?: ItemResult[];
    };
    Errors?: Array<{
      Code?: string;
      Message?: string;
    }>;
  }

  function GetItems(
    commonParameters: CommonParameters,
    requestParameters: GetItemsRequestParameters
  ): Promise<GetItemsResponse>;

  export default {
    GetItems,
  };
}
