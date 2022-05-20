/* eslint-disable no-await-in-loop */
const express = require('express');
const app = express();
const http = require('http').Server(app);
const https = require('https');
const io = require('socket.io')(http);
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');
const cp = require('child_process');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const config = require('./config.json');
const extract = require('extract-zip');
const fetch = require('node-fetch');
const crypto = require('crypto');

const runningServers = new Map();

//enable files upload
app.use(
    fileUpload({createParentPath: true})
);

//add other middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
if (config.extensiveLogging)
    app.use(morgan('dev'));
app.use('/static', express.static('static'));
app.set('view engine', 'ejs');

(async () => {
    const db = await open({
        filename: 'database.db',
        driver: sqlite3.Database
    });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS servers
        (id INTEGER PRIMARY KEY AUTOINCREMENT,
        created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        name varchar NOT NULL,
        status varchar NOT NULL,
        software varchar NULL,
        version varchar NULL)
    `);
    await db.run('UPDATE servers SET status = ? WHERE status = ?', ['stopped', 'running']);

    prepareDirectorys();

    //Dashboard page
    app.get('/', async function (req, res) {
        res.render('index.ejs', { servers: await db.all('SELECT * FROM servers'), eula: config.eula });
    });

    //Server page
    app.get('/servers/:id', async (req, res) => {
        if (!req.params.id || req.params.id === 'undefined') {
            return res.send({status: 'ERROR'});
        }
        const result = await db.get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
        res.render('server.ejs', { server: result });
    });

    //Mod page
    app.get('/servers/:id/mods', async (req, res) => {
        if (!req.params.id || req.params.id === 'undefined') {
            return res.send({status: 'ERROR'});
        }

        const serverDir = `minecraft/servers/${req.params.id}`;
        const result = await db.get('SELECT * FROM servers WHERE id = ?', [req.params.id]);

        if (!fs.existsSync(`${serverDir}/mods`))
            fs.mkdirSync(`${serverDir}/mods`);

        const mods = fs.readdirSync(`${serverDir}/mods`);

        let modList = [];
        for (let i = 0; i < mods.length; i++) {
            // eslint-disable-next-line camelcase
            modList.push({title: mods[i], icon_url: '/static/icons/favicon.ico', description: 'Loading', body: '', file: mods[i]});
        }

        res.render('mods.ejs', { server: result, mods: modList });

        modList = await getModList(serverDir);
        if (modList)
            io.emit('mod_list', modList);
    });

    //Plugin page
    app.get('/servers/:id/plugins', async function (req, res) {
        if (!req.params.id || req.params.id === 'undefined') {
            return res.send({status: 'ERROR'});
        }

        const serverDir = `minecraft/servers/${req.params.id}`;
        const result = await db.get('SELECT * FROM servers WHERE id = ?', [req.params.id]);

        if (!fs.existsSync(`${serverDir}/plugins`))
            fs.mkdirSync(`${serverDir}/plugins`);

        const plugins = fs.readdirSync(`${serverDir}/plugins`);


        res.render('plugins.ejs', { server: result, plugins });
    });

    //Create server
    app.post('/api/server', async (req, res) => {
        const name = req.body.name;
        const software = req.body.software;
        const version = req.body.version;

        if (!name || !software) return res.status(400).send({ status: 'ERROR', message: 'invalid form data' });

        // Create database record and server directory
        const result = await db.run('INSERT INTO servers (name, status, software, version) VALUES (?, ?, ?, ?)', [name, 'creating', software, version]);
        serverListUpdate(await db.all('SELECT * FROM servers'));
        const serverID = result.lastID;
        const serverDir = `minecraft/servers/${serverID}`;

        // Create server directory
        fs.mkdirSync(serverDir);

        res.send({ status: 'OK', serverID: serverID });

        //Install software
        await installSoftware(software.toLowerCase(), serverID, db);
    });

    //Delete server
    app.delete('/api/server/:id', async (req, res) => {
        const serverID = req.params.id;
        const serverData = await db.get('SELECT * FROM servers WHERE id = ?', [serverID]);
        const serverDir = `minecraft/servers/${serverID}`;

        if (!serverData) return res.status(404).send({ status: 'ERROR', message: 'server not found' });

        // Delete database record and server directory
        await db.run('DELETE FROM servers WHERE id = ?', [serverID]);
        serverListUpdate(await db.all('SELECT * FROM servers'));

        fs.rmSync(serverDir, { recursive: true, force: true });
        res.send({ status: 'OK' });
    });

    //Start server
    app.post('/api/server/:id/start', async (req, res) => {
        const serverID = req.params.id;
        const serverDir = `minecraft/servers/${serverID}`;
        const serverData = await db.get('SELECT * FROM servers WHERE id = ?', [serverID]);

        if (!serverData) return res.status(404).send({ status: 'ERROR', message: 'Server not found' });

        if (!fs.existsSync(serverDir))
            return res.send({ status: 'ERROR', message: 'Server folder not found!' });

        // Accept minecraft eula
        if (config.eula)
            fs.writeFileSync(`${serverDir}/eula.txt`, config.eulaText);

        let jar = `minecraft/software/${serverData.software.toLowerCase()}.jar`;

        if (!fs.existsSync(jar))
            return res.send({ status: 'ERROR', message: `Could not find ${jar}` });
        else
            console.log(`Starting server with jarfile ${jar}`);

        let logs = '';

        const serverProcess = cp.spawn('java', [
            '-jar',
            `${__dirname}/${jar}`,
            'nogui'
        ], { cwd: serverDir });

        serverProcess.stdout.on('data', (data) => {
            if (config.extensiveLogging)
                console.log(`stdout: ${data}`.trimEnd());
            logs += data.toString();
            io.emit('server_logs', { server: serverID, data: logs });
        });

        runningServers.set(serverDir, serverProcess);

        await db.run('UPDATE servers SET status = ? WHERE id = ?', ['running', serverID]);
        serverListUpdate(await db.all('SELECT * FROM servers'));

        res.send({ status: 'OK' });

        serverProcess.on('close', async (code) => {
            if (code === 0)
                await db.run('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverID]);
            else
                await db.run('UPDATE servers SET status = ? WHERE id = ?', ['crash', serverID]);

            console.log(`server process stopped with code ${code}`);
            serverListUpdate(await db.all('SELECT * FROM servers'));
        });
    });

    //Stop server
    app.post('/api/server/:id/stop', async (req, res) => {
        const serverID = req.params.id;
        const serverDir = `minecraft/servers/${serverID}`;
        //const serverData = await db.get('SELECT * FROM servers WHERE id = ?', [serverID]);
        runningServers.forEach(async (serverProcess, dir) => {
            if (dir === serverDir) {
                console.log('killing server process');
                serverProcess.stdin.write('/stop\n');
                sleep(5000).then(() => {
                    //TODO: Force
                    serverProcess.kill(0);
                });
            }
        });

        res.send({ status: 'OK' });
    });

    //Upload server zip
    app.post('/api/server/upload', async (req, res) => {
        if (!req.files) {
            res.send({
                status: 'ERROR',
                message: 'No file uploaded'
            });
        } else {
            let upload = req.files.upload;
            upload.mv(`temp/${upload.name}`);

            //send response
            res.send({
                status: true,
                message: 'File is uploaded',
                data: {
                    name: upload.name,
                    mimetype: upload.mimetype,
                    size: upload.size
                }
            });

            const result = await db.run('INSERT INTO servers (name, status, software) VALUES (?, ?, ?)', [upload.name.split('.zip')[0], 'creating', 'Unknown']);
            serverListUpdate(await db.all('SELECT * FROM servers'));
            const serverID = result.lastID;
            const serverDir = `minecraft/servers/${serverID}`;
            fs.mkdirSync(serverDir);

            // Unpack minecraft server
            try {
                await extract(`temp/${upload.name}`, { dir: `${__dirname}/${serverDir}` });
            } catch (error) {
                console.error(error);
            }

            // Delete zip file
            fs.rmSync(`temp/${upload.name}`);

            // Get server software
            const serverSoftware = getServerSoftware(serverDir);

            //Install software
            installSoftware(serverSoftware.toLowerCase(), serverID, db);

            // Update database
            await db.run('UPDATE servers SET software = ? WHERE id = ?', [serverSoftware, serverID]);
            serverListUpdate(await db.all('SELECT * FROM servers'));
        }
    });

    //Change server name
    app.post('/api/server/:id/change/name', async (req, res) => {
        const serverID = req.params.id;
        const value = req.body.value;

        await db.run('UPDATE servers SET name = ? WHERE id = ?', [value, serverID]);

        res.send({ status: 'OK' });
    });

    //Change server version
    app.post('/api/server/:id/change/version', async (req, res) => {
        const serverID = req.params.id;
        const value = req.body.value;

        await db.run('UPDATE servers SET version = ? WHERE id = ?', [value, serverID]);

        res.send({ status: 'OK' });
    });

    //Install a mod
    app.post('/api/server/:id/mods/:slug', async (req, res) => {
        const serverID = req.params.id;
        const slug = req.params.slug;
        const serverDir = `minecraft/servers/${serverID}`;
        const serverData = await db.get('SELECT * FROM servers WHERE id = ?', [serverID]);

        if (!serverData) return res.send({ status: 'ERROR', message: 'Server not found' });
        if (!fs.existsSync(serverDir)) return res.send({ status: 'ERROR', message: 'Server folder not found!' });

        console.log(`Downloading mod ${slug}`);

        // Get mod
        try {
            const response = await fetch(`https://api.modrinth.com/v2/project/${slug}/version`);
            const mod = await response.json();

            const index = mod.findIndex((version) => version.game_versions.includes(serverData.version) && version.loaders.includes(serverData.software.toLowerCase()));
            const version = mod[index];

            if (!version) return res.send({ status: 'ERROR', message: 'No compatible mod version found' });

            // Get mod file
            const modFile = version.files[0].url;
            const modFilename = version.files[0].filename;
            if (!fs.existsSync(`${serverDir}/mods`))
                fs.mkdirSync(`${serverDir}/mods`);

            console.log(`Downloading mod ${modFile.replace('cdn', 'cdn-raw')}`);

            await downloadFile(modFile.replace('cdn', 'cdn-raw'), `minecraft/servers/${serverID}/mods/${modFilename}`);

            const modList = await getModList(serverDir);

            if (modList)
                io.emit('mod_list', modList);

            console.log(`Mod ${modFilename} downloaded`);
            return res.send({ status: 'OK' });
        } catch (e) {
            return res.send({ status: 'ERROR', message: e.toString() });
        }
    });

    //Delete a mod
    app.delete('/api/server/:id/mods/:filename', async (req, res) => {
        const serverID = req.params.id;
        const filename = req.params.filename;
        const serverDir = `minecraft/servers/${serverID}`;
        const serverData = await db.get('SELECT * FROM servers WHERE id = ?', [serverID]);
        if (!serverData) return res.send({ status: 'ERROR', message: 'Server not found' });
        if (!fs.existsSync(serverDir)) return res.send({ status: 'ERROR', message: 'Server folder not found!' });

        const file = `${serverDir}/mods/${filename}`;

        if (!fs.existsSync(file))
            return res.send({ status: 'ERROR', message: 'Mod not found' });

        fs.unlinkSync(file);

        const modList = await getModList(serverDir);

        if (modList)
            io.emit('mod_list', modList);

        res.send({ status: 'OK' });
    });

    //Delete a plugin
    app.delete('/api/server/:id/plugins/:filename', async (req, res) => {
        const serverID = req.params.id;
        const filename = req.params.filename;
        const serverDir = `minecraft/servers/${serverID}`;
        const serverData = await db.get('SELECT * FROM servers WHERE id = ?', [serverID]);
        if (!serverData) return res.send({ status: 'ERROR', message: 'Server not found' });
        if (!fs.existsSync(serverDir)) return res.send({ status: 'ERROR', message: 'Server folder not found!' });

        const file = `${serverDir}/plugins/${filename}`;

        if (!fs.existsSync(file))
            return res.send({ status: 'ERROR', message: 'Plugin not found' });

        fs.unlinkSync(file);

        res.send({ status: 'OK' });
    });
})();

function serverListUpdate(servers) {
    io.emit('update_server_list', servers);
}

function getServerSoftware(serverDir) {
    if (fs.existsSync(`${serverDir}/.fabric`))
        return 'Fabric';
    if (fs.existsSync(`${serverDir}/paper.yml`))
        return 'Paper';
    return 'Unknown';
}

async function installSoftware(software, serverID, db) {
    const serverDir = `minecraft/servers/${serverID}`;

    if (!fs.existsSync(`${__dirname}/minecraft/software/${software}.jar`)) {
        await downloadSoftware(software);
    }

    const serverProcess = cp.spawn('java', [
        '-jar',
        `${__dirname}/minecraft/software/${software}.jar`
    ], { cwd: serverDir });

    serverProcess.stdout.on('data', (data) => {
        if (config.extensiveLogging)
            console.log(`stdout: ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    //TODO: Futher error handling
    serverProcess.on('close', async (code) => {
        console.log(`server process stopped with code ${code}`);

        if (code === 0)
            await db.run('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverID]);
        else
            await db.run('UPDATE servers SET status = ? WHERE id = ?', ['error', serverID]);

        serverListUpdate(await db.all('SELECT * FROM servers'));
    });
}

async function downloadSoftware(software) {
    //download software
    try {
        await downloadFile(config.software[software].downloadUrl, `minecraft/software/${software}.jar`);
    } catch (e) {
        console.error(e);
    }
}

async function downloadFile(url, path) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(path);
        https.get(url, function (response) {
            response.pipe(file);
            file.on('finish', function () {
                file.close(resolve);  // close() is async, call cb after close completes.
            });
        }).on('error', function (err) { // Handle errors
            fs.unlinkSync(path); // Delete the file
            reject(err.message);
        });
    });
}

function prepareDirectorys() {
    if (!fs.existsSync('minecraft'))
        fs.mkdirSync('minecraft');
    if (!fs.existsSync('minecraft/servers'))
        fs.mkdirSync('minecraft/servers');
    if (!fs.existsSync('minecraft/software'))
        fs.mkdirSync('minecraft/software');
    if (fs.existsSync('temp'))
        fs.rmdirSync('temp', {recursive: true, force: true});
}

io.on('connection', function (socket) {
    socket.on('server_cmd', (data) => {
        const serverID = data.id;
        const serverDir = `minecraft/servers/${serverID}`;
        runningServers.forEach(async (serverProcess, dir) => {
            if (dir === serverDir) {
                console.log(`stdin: ${data.command}`);
                serverProcess.stdin.write(`${data.command}\n`);
            }
        });
    });

    socket.on('search_mods', async (value, version) => {
        try {
            const response = await fetch(`https://api.modrinth.com/v2/search?limit=100&index=relevance&facets=[["categories:fabric"],["versions:${version}"],["server_side:required","server_side:optional"]]&query=${value}`);
            response.json().then((data) => {
                socket.emit('mods', data);
            });
        } catch (e) {
            if (config.extensiveLogging)
                console.error(e);
        }
    });
});

http.listen(process.env.PORT || 3000, () => {
    console.log(`listening on *:${process.env.PORT || 3000}`);
});

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

//Kill all active minecraft servers before leaving
process.on('beforeExit', () => {
    runningServers.forEach(async (serverProcess) => {
        console.log('killing server process');
        serverProcess.stdin.write('/stop\n');
        await sleep(5000);
        serverProcess.kill(0);
    });
});

async function getModList(serverDir) {
    //Create mod directory if needed
    if (!fs.existsSync(`${serverDir}/mods`))
        fs.mkdirSync(`${serverDir}/mods`);

    const mods = fs.readdirSync(`${serverDir}/mods`);

    let versionList = [];
    let modList = [];

    for (let i = 0; i < mods.length; i++) {
        const mod = mods[i];
        const modPath = `${serverDir}/mods/${mod}`;
        const modFile = fs.readFileSync(modPath);
        const modHash = crypto.createHash('sha1').update(modFile).
            digest('hex');
        const versionUrl = `https://api.modrinth.com/v2/version_file/${modHash}?algorithm=sha1`;

        try {
            const d = await fetch(versionUrl);
            versionList[versionList.push(await d.json()) - 1].file = mods[i];
        } catch (e) {
            // eslint-disable-next-line camelcase
            modList.push({title: mods[i], icon_url: '/static/icons/favicon.ico', description: 'Could not find mod on modrinth', body: 'This is most probably the case because the mod was loaded manually.', file: mods[i]});
            if (config.extensiveLogging)
                console.error(e);
        }
    }

    for (let i = 0; i < versionList.length; i++) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const d = await fetch(`https://api.modrinth.com/v2/project/${versionList[i].project_id}`);
            // eslint-disable-next-line no-await-in-loop
            modList[modList.push(await d.json()) - 1].file = versionList[i].file;
        } catch (e) {
            console.error(e);
        }
    }

    return modList;
}