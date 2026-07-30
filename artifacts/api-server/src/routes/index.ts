import { Router, type IRouter } from "express";
import healthRouter from "./health";
import timeEntriesRouter from "./time-entries";

const router: IRouter = Router();

router.use(healthRouter);
router.use(timeEntriesRouter);

export default router;
