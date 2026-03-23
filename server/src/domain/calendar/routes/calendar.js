const { Router } = require('express');
const calendarController = require('../controller/calendarController');

const router = Router();

router.get('/api/calendar', calendarController.getCalendar);

module.exports = router;
