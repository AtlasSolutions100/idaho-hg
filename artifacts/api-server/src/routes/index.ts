import { Router, type IRouter } from "express";
import healthRouter from "./health";
import timeEntriesRouter from "./time-entries";
import ratesRouter from "./rates";

const router: IRouter = Router();

router.use(healthRouter);
router.use(timeEntriesRouter);
router.use(ratesRouter);

export default router;
