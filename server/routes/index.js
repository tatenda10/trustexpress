import { Router } from 'express';
import usersRouter from './users.js';
import passengersRouter from './passengers.js';
import driversRouter from './drivers.js';
import ridesRouter from './rides.js';
import uploadRouter from './upload.js';
import verifyPhoneRouter from './verifyPhone.js';
import adminAuthRouter from './adminAuth.js';
import adminDriversRouter from './adminDrivers.js';
import adminPassengersRouter from './adminPassengers.js';
import adminRolesRouter from './adminRoles.js';
import adminVehicleTiersRouter from './adminVehicleTiers.js';
import adminPricingRouter from './adminPricing.js';
import adminReportsRouter from './adminReports.js';
import adminRidesRouter from './adminRides.js';
import adminSupportRouter from './adminSupport.js';
import adminOverviewRouter from './adminOverview.js';
import adminAgentsRouter from './adminAgents.js';
import adminAgentRewardsRouter from './adminAgentRewards.js';
import agentAuthRouter from './agentAuth.js';
import agentInvitesRouter from './agentInvites.js';
import agentRecruitmentRouter from './agentRecruitment.js';
import agentRewardsRouter from './agentRewards.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'trust-express-api' });
});

router.use('/users', usersRouter);
router.use('/passengers', passengersRouter);
router.use('/drivers', driversRouter);
router.use('/rides', ridesRouter);
router.use('/upload', uploadRouter);
router.use('/verify-phone', verifyPhoneRouter);
router.use('/admin/auth', adminAuthRouter);
router.use('/admin/drivers', adminDriversRouter);
router.use('/admin/passengers', adminPassengersRouter);
router.use('/admin/roles', adminRolesRouter);
router.use('/admin/agents', adminAgentsRouter);
router.use('/admin/agent-rewards', adminAgentRewardsRouter);
router.use('/admin/vehicle-tiers', adminVehicleTiersRouter);
router.use('/admin/pricing', adminPricingRouter);
router.use('/admin/overview', adminOverviewRouter);
router.use('/admin/reports', adminReportsRouter);
router.use('/admin/rides', adminRidesRouter);
router.use('/admin/support', adminSupportRouter);
router.use('/agent/auth', agentAuthRouter);
router.use('/agent', agentInvitesRouter);
router.use('/agent', agentRecruitmentRouter);
router.use('/agent', agentRewardsRouter);

export default router;
