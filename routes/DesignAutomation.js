const _path = require('path');
const _fs = require('fs');
const _url = require('url');
const express = require('express');
//const http = require('http');
const http = require('https');
const formdata = require('form-data');
const bodyParser = require('body-parser');
const multer = require('multer');
const router = express.Router();
const { getClient } = require('./common/oauth');
const config = require('../config');
const dav3 = require('autodesk.forge.designautomation');
const APS = require('forge-apis');

router.use(bodyParser.json());

// Middleware for obtaining a token for each request.
router.use(async (req, res, next) => {
    try {
      console.log("router.use: " + req.session.client_id)
      let client =  new APS.AuthClientTwoLegged(
        req.session.client_id,
        req.session.client_secret,
        config.scopes.internal,
        false
      )
      let credentials = await client.authenticate();
      req.oauth_client = client;
      req.oauth_token = credentials;
    } catch {} 
   
    next();
});

// Static instance of the DA API
let dav3Instance = null;

class Utils {

    static async Instance() {
        if (dav3Instance === null) {
            // Here it is ok to not await since we awaited in the call router.use()
            dav3Instance = new dav3.AutodeskForgeDesignAutomationClient(config.client);
            let FetchRefresh = async (data) => { // data is undefined in a fetch, but contains the old credentials in a refresh
                let client = await getClient();
                let credentials = client.getCredentials();
                // The line below is for testing
                //credentials.expires_in = 30; credentials.expires_at = new Date(Date.now() + credentials.expires_in * 1000);
                return (credentials);
            };
            dav3Instance.authManager.authentications['2-legged'].fetchToken = FetchRefresh;
            dav3Instance.authManager.authentications['2-legged'].refreshToken = FetchRefresh;
        }
        return (dav3Instance);
    }

    /// <summary>
    /// Returns the directory where bindles are stored on the local machine.
    /// </summary>
    static get LocalBundlesFolder() {
        return (_path.resolve(_path.join(__dirname, '../', 'bundles')));
    }

    /// <summary>
    /// Prefix for Activities and Bucket
    /// </summary>
    static getNickName(req) {
        return (req.session.client_id);
    }

    /// <summary>
    /// Prefix for Activities and Bucket
    /// </summary>
    static getBucketName(req) {
      return Utils.getNickName(req).toLowerCase() + '-designautomation'
  }

    /// <summary>
    /// Alias for the app (e.g. DEV, STG, PROD). This value may come from an environment variable
    /// </summary>
    static get Alias() {
        return ('dev');
    }

    /// <summary>
    /// Search files in a folder and filter them.
    /// </summary>
    static async findFiles(dir, filter) {
        return (new Promise((fulfill, reject) => {
            _fs.readdir(dir, (err, files) => {
                if (err)
                    return (reject(err));
                if (filter !== undefined && typeof filter === 'string')
                    files = files.filter((file) => {
                        return (_path.extname(file) === filter);
                    });
                else if (filter !== undefined && typeof filter === 'object')
                    files = files.filter((file) => {
                        return (filter.test(file));
                    });
                fulfill(files);
            });
        }));
    }

    /// <summary>
    /// Create a new DAv3 client/API with default settings
    /// </summary>
    static async dav3API(oauth2) {
        // There is 2 alternatives to setup an API instance, providing the access_token directly
        let apiClient2 = new dav3.AutodeskForgeDesignAutomationClient(/*config.client*/);
        apiClient2.authManager.authentications['2-legged'].accessToken = oauth2.access_token;
        return (new dav3.AutodeskForgeDesignAutomationApi(apiClient2));

        // Or use the Auto-Refresh feature
        //let apiClient = await Utils.Instance();
        //return (new dav3.AutodeskForgeDesignAutomationApi(apiClient));
    }

    /// <summary>
    /// Helps identify the engine
    /// </summary>
    static EngineAttributes(engine) {
        if (engine.includes('Inventor'))
            return ({
                commandLine: '$(engine.path)\\InventorCoreConsole.exe /i "$(args[inputFile].path)" /s "$(args[inputCode].path)" /iLogicVerbosity Trace',
                extension: 'ipt',
                script: ''
            });

        throw new Error('Invalid engine');
    }

    static FormDataLength(form) {
        return (new Promise((fulfill, reject) => {
            form.getLength((err, length) => {
                if (err)
                    return (reject(err));
                fulfill(length);
            });
        }));
    }

    /// <summary>
    /// Upload a file
    /// </summary>
    static uploadFormDataWithFile(filepath, endpoint, params = null) {
        return (new Promise(async (fulfill, reject) => {
            const fileStream = _fs.createReadStream(filepath);

            const form = new formdata();
            if (params) {
                const keys = Object.keys(params);
                for (let i = 0; i < keys.length; i++)
                    form.append(keys[i], params[keys[i]]);
            }
            form.append('file', fileStream);

            let headers = form.getHeaders();
            headers['Cache-Control'] = 'no-cache';
            headers['Content-Length'] = await Utils.FormDataLength(form);

            const urlinfo = _url.parse(endpoint);
            const postReq = http.request({
                host: urlinfo.host,
                port: (urlinfo.port || (urlinfo.protocol === 'https:' ? 443 : 80)),
                path: urlinfo.pathname,
                method: 'POST',
                headers: headers
            },
                response => {
                    fulfill(response.statusCode);
                },
                err => {
                    reject(err);
                }
            );

            form.pipe(postReq);
        }));
    }
}

/// <summary>
/// Return a list of available engines
/// </summary>
router.get('/aps/datamanagement/objects', async (req, res) => {
  let that = this;
  let allObjects = [];
  let paginationToken = null;
  let bucketName = Utils.getBucketName(req);
  try {
      const api = new APS.ObjectsApi();
      while (true) {
        let objects = await api.getObjects(bucketName, { 'startAt': paginationToken }, req.oauth_client, req.oauth_token);
        allObjects = allObjects.concat(objects.body.items.map(item => item.objectKey));
        if (objects.body.next == null) break;
        const urlParams = new URLSearchParams(objects.body.next);
        paginationToken = urlParams.get('startAt');
      }
      res.json(allObjects.sort()); // return list of engines
  } catch (ex) {
      console.error(ex);
      if (ex.response.status === 404)
        res.status(404).json({ message: `Bucket '${bucketName}' not found. Please create it` });
      else  
        res.json(500).json({ message: ex.message });
  }

});

/// <summary>
/// Return a list of available engines
/// </summary>
router.get('/aps/designautomation/engines', async /*GetAvailableEngines*/(req, res) => {
    let that = this;
    let allEngines = [];
    let paginationToken = null;
    try {
        const api = await Utils.dav3API(req.oauth_token);
        while (true) {
            let engines = await api.getEngines({ 'page': paginationToken });
            allEngines = allEngines.concat(engines.data)
            if (engines.paginationToken == null) break;
            paginationToken = engines.paginationToken;
        }
        allEngines = allEngines.filter((engine) => 
          engine.includes('Autodesk.Inventor')
        );
        res.json(allEngines.sort()); // return list of engines
    } catch (ex) {
        console.error(ex);
        res.json([]);
    }

});

/// <summary>
/// CreateActivity a new Activity
/// </summary>
router.post('/aps/designautomation/activities', async /*CreateActivity*/(req, res) => {
    const activitySpecs = req.body;

    // basic input validation
    const engineName = activitySpecs.engine;

    // standard name for this sample
    const activityName = `iLogicActivity_${engineName.replace('+', '_').replace('.', '_')}`;

    // get defined activities
    const api = await Utils.dav3API(req.oauth_token);
    let activities = null;
    try {
        activities = await api.getActivities();
    } catch (ex) {
        console.error(ex);
        return (res.status(500).json({
            diagnostic: 'Failed to get activity list'
        }));
    }
    const qualifiedActivityId = `${Utils.getNickName(req)}.${activityName}+${Utils.Alias}`;
    if (!activities.data.includes(qualifiedActivityId)) {
        // define the activity
        // ToDo: parametrize for different engines...
        const engineAttributes = Utils.EngineAttributes(engineName);
        const commandLine = engineAttributes.commandLine;
        const activitySpec = {
            id: activityName,
            appbundles: [],
            commandLine: [commandLine],
            engine: engineName,
            parameters: {
                inputFile: {
                    description: 'input file',
                    ondemand: false,
                    required: true,
                    verb: dav3.Verb.get,
                    zip: false
                },
                inputCode: {
                    description: 'input iLogic code',
                    ondemand: false,
                    required: true,
                    verb: dav3.Verb.get,
                    zip: false
                },
                outputFile: {
                    description: 'output file',
                    localName: 'outputFiles',
                    ondemand: false,
                    required: false,
                    verb: dav3.Verb.put,
                    zip: true
                }
            },
            settings: {
                script: {
                    value: engineAttributes.script
                }
            }
        };
        try {
            await api.createActivity(activitySpec);
        } catch (ex) {
            console.error(ex);
            return (res.status(500).json({
                diagnostic: 'Failed to create new activity'
            }));
        }
        // specify the alias for this Activity
        const aliasSpec = {
            id: Utils.Alias,
            version: 1
        };
        try {
            const newAlias = await api.createActivityAlias(activityName, aliasSpec);
        } catch (ex) {
            console.error(ex);
            return (res.status(500).json({
                diagnostic: 'Failed to create new alias for activity'
            }));
        }
        res.status(200).json({
            activity: qualifiedActivityId
        });
        return;
    }

    // as this activity points to a AppBundle "dev" alias (which points to the last version of the bundle),
    // there is no need to update it (for this sample), but this may be extended for different contexts
    res.status(200).json({
        activity: 'Activity already defined'
    });
});

/// <summary>
/// Get all Activities defined for this account
/// </summary>
router.get('/aps/designautomation/activities', async /*GetDefinedActivities*/(req, res) => {
    const api = await Utils.dav3API(req.oauth_token);
    // filter list of 
    let activities = null;
    try {
        activities = await api.getActivities();
    } catch (ex) {
        console.error(ex);
        return (res.status(500).json({
            diagnostic: 'Failed to get activity list'
        }));
    }
    let definedActivities = [];
    for (let i = 0; i < activities.data.length; i++) {
        let activity = activities.data[i];
        if (activity.startsWith(Utils.getNickName(req)) && activity.indexOf('$LATEST') === -1)
            definedActivities.push(activity.replace(Utils.getNickName(req) + '.', ''));
    }

    res.status(200).json(definedActivities);
});

/// <summary>
/// Direct To S3 
/// ref : https://aps.autodesk.com/blog/new-feature-support-direct-s3-migration-inputoutput-files-design-automation
/// </summary>

const getObjectId = async (bucketKey, objectKey, req) => {
    try {
        let contentStream = _fs.createReadStream(req.file.path);

        //uploadResources takes an Object or Object array of resource to uplaod with their parameters,
        //we are just passing only one object.
        let uploadResponse = await new APS.ObjectsApi().uploadResources(
            bucketKey,
            [
                //object
                {
                    objectKey: objectKey,
                    data: contentStream,
                    length: req.file.size
                }
            ],
            {
                useAcceleration: false, //Whether or not to generate an accelerated signed URL
                minutesExpiration: 20, //The custom expiration time within the 1 to 60 minutes range, if not specified, default is 2 minutes
                onUploadProgress: (data) => console.warn(data) // function (progressEvent) => {}
            },
            req.oauth_client, req.oauth_token,
        );
        //lets check for the first and only entry.
        if (uploadResponse[0].hasOwnProperty('error') && uploadResponse[0].error) {
            throw new Error(uploadResponse[0].completed.reason);
        }
        console.log(uploadResponse[0].completed.objectId);
        return (uploadResponse[0].completed.objectId);
    } catch (ex) {
        console.error("Failed to create ObjectID\n", ex)
        throw ex;
    }
}

/// <summary>
/// Start a new workitem
/// </summary>
router.post('/aps/designautomation/workitems', multer({
    dest: 'uploads/'
}).single('inputCode'), async /*StartWorkitem*/(req, res) => {
    const input = req.body;

    // basic input validation
    const workItemData = JSON.parse(input.data);
    const inputFile = workItemData.inputFile;
    const inputCode = req.file.originalname;
    const outputFile = workItemData.outputFile;
    const activityName = `${Utils.getNickName(req)}.${workItemData.activityName}`;
    const browserConnectionId = workItemData.browserConnectionId;

    // save the file on the server
    //const ContentRootPath = _path.resolve(_path.join(__dirname, '../..'));
    //const fileSavePath = _path.join(ContentRootPath, _path.basename(req.file.originalname));

    // upload file to OSS Bucket
    // 1. ensure bucket existis
    const bucketKey = Utils.getBucketName(req);
    try {
        let payload = new APS.PostBucketsPayload();
        payload.bucketKey = bucketKey;
        payload.policyKey = 'transient'; // expires in 24h
        await new APS.BucketsApi().createBucket(payload, {}, req.oauth_client, req.oauth_token);
    } catch (ex) {
        // in case bucket already exists
    }
    // 2. upload inputFile
    // prepare workitem arguments
    const bearerToken = ["Bearer", req.oauth_token.access_token].join(" ");
    // 1. input file
    const inputFileOss = `urn:adsk.objects:os.object:${bucketKey}/${inputFile}`
    const inputFileArgument = {
        url: inputFileOss,
        headers: { "Authorization": bearerToken }
    };
    // 2. input json
    const inputCodeArgument = {
      url: await getObjectId(bucketKey, inputCode, req),
      headers: { "Authorization": bearerToken }
    };
    // 3. output file
    const outputFileOss = `urn:adsk.objects:os.object:${bucketKey}/${outputFile}`
    const outputFileArgument = {
        url: outputFileOss,
        verb: dav3.Verb.put,
        headers: { "Authorization": bearerToken }
    };

    // prepare & submit workitem
    // the callback contains the connectionId (used to identify the client) and the outputFileName of this workitem
    const callbackUrl = `${config.credentials.webhook_url}/api/aps/callback/designautomation?id=${browserConnectionId}&bucketKey=${bucketKey}&outputFileName=${outputFile}&inputFileName=${inputFile}`;
    const workItemSpec = {
        activityId: activityName,
        arguments: {
            onComplete: {
                verb: dav3.Verb.post,
                url: callbackUrl
            }
        }
    };

    if (inputFile)
        workItemSpec.arguments.inputFile = inputFileArgument;
    if (inputCode)
        workItemSpec.arguments.inputCode = inputCodeArgument;
    if (outputFile)
        workItemSpec.arguments.outputFile = outputFileArgument;

    let workItemStatus = null;
    try {
        const api = await Utils.dav3API(req.oauth_token);
        workItemStatus = await api.createWorkItem(workItemSpec);
    } catch (ex) {
        console.error(ex);
        return (res.status(500).json({
            diagnostic: 'Failed to create a workitem'
        }));
    }
    res.status(200).json({
        workItemId: workItemStatus.id
    });
});

/// <summary>
/// Callback from Design Automation Workitem (onProgress or onComplete)
/// </summary>
router.post('/aps/callback/designautomation', async /*OnCallback*/(req, res) => {
    // your webhook should return immediately! we could use Hangfire to schedule a job instead
    // ALWAYS return ok (200)
    res.status(200).end();

    try {
        const socketIO = require('../server').io;

        // your webhook should return immediately! we can use Hangfire to schedule a job
        const bodyJson = req.body;
        socketIO.to(req.query.id).emit('onComplete', bodyJson);

        http.get(
            bodyJson.reportUrl,
            response => {
                //socketIO.to(req.query.id).emit('onComplete', response);
                response.setEncoding('utf8');
                let rawData = '';
                response.on('data', (chunk) => {
                    rawData += chunk;
                });
                response.on('end', () => {
                    socketIO.to(req.query.id).emit('onComplete', rawData);
                });
            }
        );
    } catch (ex) {
        console.error(ex);
    }
});

/// <summary>
/// Clear the accounts (for debugging purpouses)
/// </summary>
router.delete('/aps/designautomation/account', async /*ClearAccount*/(req, res) => {
    let api = await Utils.dav3API(req.oauth_token);
    // clear account
    await api.deleteForgeApp('me');
    res.status(200).end();
});

module.exports = router;