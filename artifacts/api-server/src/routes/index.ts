import { Router, type IRouter } from "express";
import healthRouter from "./health";
import timeEntriesRouter from "./time-entries";
import ratesRouter from "./rates";
import onboardingRouter from "./onboarding";
import rosterRouter from "./roster";
import reportsRouter from "./reports";
import demoDataRouter from "./demo-data";

const router: IRouter = Router();

router.use(healthRouter);
router.use(timeEntriesRouter);
router.use(ratesRouter);
router.use(onboardingRouter);
router.use(rosterRouter);
router.use(reportsRouter);
router.use(demoDataRouter);

export default router;
