import { Router, type IRouter } from "express";
import healthRouter from "./health";
import timeEntriesRouter from "./time-entries";
import ratesRouter from "./rates";
import rosterRouter from "./roster";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(timeEntriesRouter);
router.use(ratesRouter);
router.use(rosterRouter);
router.use(reportsRouter);

export default router;
