const express = require('express')
var bodyParser = require('body-parser')
const axios = require('axios')
const net = require('net')
const indy = require('indy-sdk')
const requireNew = require('require-new')
const io = require("socket.io")
const http = require("http")
const path = require('path')
// import io from "socket.io";
// import http from 'http'

const app = express()
app.use(bodyParser.json())
const web_port = process.argv[2]
// const tcp_port = process.argv[3]

// let gov = requireNew('./standard_agent')
let agent = requireNew('./standard_agent')
let steward = requireNew('./standard_agent')

let req = {}
let res = {}

let cred_reqs = {}
let creds = []

let is_challenged = false;
let is_promoted = false;
let is_inited = false;
let key = ""
let name = ""

let connected_ip = ""
let connected_port = ""
let connected_id = ""

let schemas = []

// let credentials = []

// app.use(express.static(path.join(__dirname + "/material-dashboard-react-master", 'build')));
// app.get('*', function(req, res) {
//     res.sendFile(path.join(__dirname,'material-dashboard-react-master', 'build', 'index.html'));
// });

const root = require('path').join(__dirname, 'material-dashboard-react-master', 'build')
app.use(express.static(root));
app.get("/", (req, res) => {
    res.sendFile('index.html', { root });
})

const httpServer = http.createServer(app).listen(web_port, ()=>{
    console.log(`${web_port}에서 웹 서버 실행중`)
})

const socketServer = io(httpServer);
socketServer.on('connection', socket => {
    console.log("connect client by Socket.io")

    socket.on("cred:req:approval", socket)
});

indy.setLogger(function (level, target, message, modulePath, file, line) {
    // console.log('libindy said:', level, target, message, modulePath, file, line)
    // console.log('libindy said:', message)
    // console.log('libindy said:----')
    if (level >= 5 && message.includes("Err"))
        console.log('libindy said:', message);
    return 0;
})



app.get('/api/status', (req, res) => {
    res.json({
        is_challenged,
        is_promoted,
        is_inited,
        key,
        name,
        connected_ip,
        connected_port,
        connected_id
    })
})


app.post('/api/init',async function(req, res){
    try {
        await agent.init(req.body.name, req.body.key, { 'seed': '00000000000000000000000000000Gov'})
        name = req.body.name
        key = req.body.key
        is_inited = true
        res.json("success!!")
    }
    catch(e) {
        console.log(e)
        res.status(404).send()
    }
    
})

app.get('/api/schema', function(req, res){
    res.json(schemas)
})

app.post('/api/schema', async function(req, res){
    try{
        await agent.createOrUpdateSchema(
            req.body.name, 
            "0.1", 
            req.body.attributes //["name", "age"]
        );
        let id = await agent.getCredDefId(req.body.name)
        schemas.push({
            id,
            name: req.body.name,
            attributes: req.body.attributes
        })
        res.json("success")
    }
    catch (e) {
        console.log(e)
        res.status(404).json(e + "")
    }
})

app.get("/api/credential", function(req, res){
    res.json(creds)
})

app.post("/api/credential/request", async function(req, res){
    let host = req.body.host
    let port = req.body.port
    axios.post(`${host}:${port}/api/credential/response`, {
        id: agent.getId(),
        schemaID: req.body.schemaID,
        info: req.body.info
    })
    .then(async function(r){
        console.log(r.data)
        try {
            let buffer = Buffer.from(r.data.authcryptedCredOffer.data)
            let arg = {
                targetId: r.data.targetId,
                schemaName: r.data.schemaName,
                authcryptedCredOffer: buffer,
                credDefId: r.data.credDefId
            }
            console.log(arg)
            let key = await agent.createMasterSecret(arg)
            console.log(key)
            axios.post(`${host}:${port}/api/credential/create`, {
                authcryptedCredRequest: JSON.stringify(key.authcryptedCredRequest),
                targetId: key.targetId,
                schemaName: key.schemaName,
                info: {
                    "name": {"raw": req.body.info.name, "encoded": "123123123123"},
                    "age": {"raw": req.body.info.age, "encoded": req.body.info.age}
                }
            })
            .then(async function(r){
                await agent.storeCredential({
                    targetId: r.data.targetId,
                    schemaName: r.data.schemaName,
                    authcryptedCredJson: Buffer.from(r.data.authcryptedCredJson.data)
                })
                await agent.printWallet()
                creds.push({
                    targetId: r.data.targetId,
                    schemaName: r.data.schemaName,
                    auth: JSON.stringify(r.data.authcryptedCredJson)
                })
                res.json("success")
            })
        }
        catch(e){
            console.log("eeeeee")
        }
    })
    .catch(function(err){
        // console.log("dsfsdfjkhdfjhsdfk")
        // console.log(err)
        res.status(400).send(err)
    })
})



app.post("/api/credential/create", async function(req, res){
    try {
        console.log(req.body)
        var credInfo = await agent.createCredential(
            {
                authcryptedCredRequest: Buffer.from(JSON.parse(req.body.authcryptedCredRequest).data),
                targetId: req.body.targetId,
                schemaName: req.body.schemaName
            },
            req.body.info
        )
        res.json({
            authcryptedCredJson: credInfo.authcryptedCredJson.toJSON(),
            targetId: credInfo.targetId,
            schemaName: credInfo.schemaName
        })
    }
    catch(e) {
        console.log(e)
        res.status(400).send(e)
    }
})

// host, port, schemaID 필요
app.post("/api/credential/response", async function(req, res){
    try{
        req_info = {schemaID: req.body.schemaID,info: req.body.info}
        // cred_reqs.insert(req.body.id, {approved: false, schemaID: req.body.schemaID,info: req.body.info});
        
        // socket.on("cred:approve", req => {
            var reqq = await agent.createCredentialOffer(req.body.schemaID, req.body.id);
            console.log("approved")
            console.log(reqq)
            // res.json({
            //     authcryptedCredOffer: reqq.authcryptedCredOffer.toJSON(),
            //     targetId: reqq.targetId,
            //     schemaName: reqq.schemaName,
            //     credDefId: reqq.credDefId
            // })
            res.json(reqq)
        // })
        // socket.emit("cred:request", req_info)
    }
    catch(e) {
        console.log(e)
        res.status(400).send(e)
    }
})

app.post("/api/credential/approve", function(req, res){
    try {
        cred_reqs[req.body.id].approved =true;
        res.json("success")
    }
    catch(e) {
        res.status(400).send()
    }
})

app.get("/api/credential/requests", (req, res) => {
    res.json(cred_reqs)
})

app.get("/api/credentials", (req, res)=> {
    res.json(creds)
})


app.post('/api/promote',async function(req, res){
    try {
        let steward = requireNew("./standard_agent");
        let rand = Math.random()
        await steward.init("steward" + rand, "stewardKey", { 'seed': '000000000000000000000000Steward1' })
        var req = await steward.createChallenge(agent.getId());
        var ress = await agent.createChallengeResponse(req);
        await steward.verifyChallengeResponse(ress)
        var req = await agent.createTrustAnchorRequest(steward.getId());
        await steward.acceptTrustAnchorRequest(req);
        is_promoted = true
        res.json("success")
    }
    catch(e) {
        console.log(e)
        res.status(400).send()
    }
})


app.post('/api/challenge/request', function(req,res){
    console.log("dssd")
    let host = req.body.host
    let port = req.body.port
    axios.post(`${host}:${port}/api/challenge/create`, {
        id: agent.getId(),
    })
    .then(async function(r){
        // console.log(r.data)
        var ress = await agent.createChallengeResponse(r.data);
        // console.log(ress)
        axios.post(`${host}:${port}/api/challenge/authenticate`, {
            targetId: ress.targetId,
            encryptedRes: JSON.stringify(ress.encryptedRes)
        })
        .then(async function(r){
            is_challenged = true
            connected_ip = host;
            connected_port = port;
            axios.get(`${host}:${port}/api/getId`).then(r => {
                connected_id = r.data;
                res.json({
                    ip: host,
                    port
                })
            })
        })
    })
    .catch(function(err){
        console.log(err)
        res.status(400).send("failure")
    })
})

app.post('/api/challenge/authenticate', async function(req, res){
    try {
        console.log(req.body)
        await agent.verifyChallengeResponse({
            targetId: req.body.targetId,
            encryptedRes: Buffer.from(JSON.parse(req.body.encryptedRes).data)
        })
        res.json("success")
    }
    catch(e) {
        // console.log(e)
        res.status(400).send()
    }
})

app.post('/api/challenge/create', async function(req, res){
    try {
        var reqq = await agent.createChallenge(req.body.id);
        res.json(reqq)
    }
    catch(e) {
        console.log(e)
        res.status(400).send()
    }
})

app.post('/api/request',async function(req, res){
    // for (x in res) {
    // }
    // console.log(res.req.body)
    var r = await agent.createChallengeResponse(res.req.body.req)
    console.log(r)
    res.json({
        targetId: r.targetId,
        encryptedRes: JSON.stringify(r.encryptedRes)
    })
})

app.get('/api/getId', function(req, res){
    res.json(agent.getId())
})

app.get('/api/disconnect', function(req, res){
    socket.close()
    res.json("success")
})

app.post('/api/proof/request', async function(req,res){
    axios.post(`${connected_ip}:${connected_port}/api/proof/create`, {
        schemaId: req.body.schemaId,
        id: agent.getId()
    })
    .then(async function(r){
        let proof = await agent.createProof(r.data)
        axios.post(`${connected_ip}:${connected_port}/api/proof/verify`, proof)
        .then(r => {
            res.json(r)
        })
    })
    .catch((e) => {
        res.status(400).send(e)
    })
})

app.post('/api/proof/verify', async function(req, res){
    try{
        let verified = await agent.verifyProof(req.body)
        res.json(verified)
    }
    catch(e){
        res.status(400).send(e)
    }
})

app.post('/api/proof/create', async function(req, res) {
    axios.post("http://localhost:4001/api/credential/id", req.body.schemaId)
    .then(async function(r){
        let credDefId = r.data
        let reqeustJSON =
        {
            'name': "주민등록증",
            'version': '0.1',
            'requested_attributes': {
                'attr1_referent': {
                    'name': 'name',
                    'restrictions': [{'cred_def_id': credDefId}]
                },
                'attr2_referent': {
                    'name': 'age',
                    'restrictions': [{'cred_def_id': credDefId}]
                }
           },
            "requested_predicates": {}
        };
        let proofReq = await agent.createProofRequest(requestJSON, req.body.id)
        console.log(proofReq)
        res.json(proofReq)
    })
    .catch(e =>{
        res.status(400).send(e)
    })
})

app.post('/api/credential/id',async function(req, res){
    let id = await agent.getCredDefId(res.data)
    res.json(id)
})




// app.listen(web_port, () => console.log(`Example app listening at http:localhost:${web_port}`))
