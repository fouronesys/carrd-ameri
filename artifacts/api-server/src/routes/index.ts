import { Router, type IRouter } from "express";
import healthRouter from "./health";
import wompiRouter from "./wompi";

const router: IRouter = Router();

router.use(healthRouter);
router.use(wompiRouter);

export default router;
