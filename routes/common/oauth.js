const express = require('express');
const APS = require('forge-apis');
const config = require('../../config');

let router = express.Router();

router.post('/aps/credentials', async function (req, res) {
    try {
        let credentials = await new APS.AuthClientTwoLegged(
            req.body.client_id,
            req.body.client_secret,
            config.scopes.internal,
            false
        ).authenticate();

        req.session.client_id = req.body.client_id;
        req.session.client_secret = req.body.client_secret;

        res.json({result: 'success'});
    } catch {
        res.status(500).json({result: 'error'});
    }
});

module.exports = router;
