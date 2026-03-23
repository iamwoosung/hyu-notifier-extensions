const { Router } = require('express');
const oauthRoutes = require('../../domain/oauth/routes/oauth');
const userRoutes = require('../../domain/user/routes/user');
const lmsRoutes = require('../../domain/lms/routes/lms');
const selcRoutes = require('../../domain/selc/routes/selc');
const calendarRoutes = require('../../domain/calendar/routes/calendar');

const router = Router();

router.use(oauthRoutes);
router.use(userRoutes);
router.use(lmsRoutes);
router.use(selcRoutes);
router.use(calendarRoutes);

module.exports = router;
