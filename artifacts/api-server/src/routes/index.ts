import { Router, type IRouter } from "express";
import healthRouter from "./health";
import timeEntriesRouter from "./time-entries";
import ratesRouter from "./rates";
import rosterRouter from "./roster";

const router: IRouter = Router();

router.use(healthRouter);
router.use(timeEntriesRouter);
router.use(ratesRouter);
router.use(rosterRouter);

export default router;
