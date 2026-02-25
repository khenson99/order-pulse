import { Router, Response } from "express";
import type { AuthenticatedRequest } from "../types";

const router = Router();

router.get("/session", (req, res: Response) => {
  const { sub, tenantId } = (req as AuthenticatedRequest).auth;
  res.json({
    data: {
      userId: sub,
      tenantId,
      message: "Session endpoint placeholder",
    },
  });
});

router.get("/health", (_req, res: Response) => {
  res.json({ status: "ok" });
});

export default router;
