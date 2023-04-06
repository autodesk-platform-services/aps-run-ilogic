const _path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const config = require('./config');

let app = express();
app.use(express.static(_path.join(__dirname, './public')));
app.use(cookieSession({
    name: 'aps_session',
    keys: ['aps_secure_key'],
    maxAge: 60 * 60 * 1000 // 1 hour, same as the 2 legged lifespan token
}));
app.use(express.json({
    limit: '50mb'
}));

app.use('/api', require('./routes/DesignAutomation'));
app.use('/api', require('./routes/common/oauth'));

app.set('port', process.env.PORT || 8080);

module.exports = app;
