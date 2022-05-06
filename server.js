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

//enable files upload
app.use(
    fileUpload({createParentPath: true})
);

//add other middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
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
        res.render('index.ejs', { servers: await db.all('SELECT * FROM servers'), eula: config.accept_eula });
    });

    //Server page
    app.get('/servers/:id', async function (req, res) {
        if (!req.params.id || req.params.id == 'undefined') {
            return res.send({status: 'ERROR'});
        }
        const result = await db.get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
        res.render('server.ejs', { server: result });
    });

    //Create server
    app.post('/api/server', async (req, res) => {
        const name = req.body.name;
        const software = req.body.software;

        if (!name || !software) return res.status(400).send({ status: 'ERROR', message: 'invalid form data' });

        // Create database record and server directory
        const result = await db.run('INSERT INTO servers (name, status, software) VALUES (?, ?, ?)', [name, 'creating', software]);
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
        if (config.accept_eula)
            fs.writeFileSync(`${serverDir}/eula.txt`, '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://account.mojang.com/documents/minecraft_eula).\n#\neula=true\n');


        let jar = `minecraft/software/${serverData.software.toLowerCase()}.jar`;

        if (!fs.existsSync(jar))
            return res.send({ status: 'ERROR', message: `Could not find ${jar}` });
        else
            console.log(`Starting server with jarfile ${jar}`);

        const serverProcess = cp.spawn('java', [
            '-jar',
            `${__dirname}/${jar}`,
            'nogui'
        ], { cwd: serverDir });

        serverProcess.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
            io.emit('server_logs', { server: serverID, data: data.toString() });
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

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
        const serverData = await db.get('SELECT * FROM servers WHERE id = ?', [serverID]);
        res.send({ status: 'ERROR', message: 'Not implemented yet!' });
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
        let value = req.body.value;

        await db.run('UPDATE servers SET name = ? WHERE id = ?', [value, serverID]);

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
    await downloadFile(config.software[software].downloadUrl, `minecraft/software/${software}.jar`);
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
            fs.unlink(path); // Delete the file async. (But we don't check the result)
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
    console.log('A user connected');

    socket.on('disconnect', function () {
        console.log('A user disconnected');
    });
});

http.listen(process.env.PORT || 3000, function () {
    console.log(`listening on *:${process.env.PORT || 3000}`);
});