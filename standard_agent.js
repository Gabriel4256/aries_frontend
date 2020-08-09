const indy = require('indy-sdk');
const crypto = require('crypto');
const utils = require('./utils');
const { debug } = require('console');


let ph, wh;
let walletConfig, walletCredentials;
let did, verkey;


let didForSomeone = {};
let didFromSomeone = {};
let connectionRequest = {};

async function init(id, credentialkey, didInfo = {})
{
    walletConfig = { 'id': id };
    walletCredentials = { 'key': credentialkey };

    ph = await utils.getPoolHandle(id+"Pool", "./seong.txt");
    console.log("getWalletHandle")
    wh = await utils.getWalletHandle(walletConfig, walletCredentials);
    console.log("createAndStoreMyDid : " + wh + "\n"  + JSON.stringify(didInfo))
    let asdf = await indy.createAndStoreMyDid(wh, didInfo);
    console.log(asdf)
    did = asdf[0]
    verkey = asdf[1]
    console.log("init completed : " + did + " :::: " + verkey)
}

function getId()
{
    return walletConfig.id;
}

// target에 대한 인증을 위한 챌린지를 생성함. 챌린지는 target의 createChallengeResponse 의 인자로 들어가야함
async function createChallenge(targetId)
{
    console.log("챌린지 생성 : " + getId() + " => " + targetId);
    let [didForTarget, keyForTarget] = await indy.createAndStoreMyDid(wh, {});
    didForSomeone[targetId] = {did:didForTarget, key:keyForTarget}

    await utils.sendNym(ph, wh, did, didForTarget, keyForTarget, null);

    let nonce = await indy.generateNonce();
    connectionRequest[targetId] = {
        targetId : getId(),
        did: didForTarget,
        nonce: nonce
    };
    console.log(JSON.stringify(connectionRequest[targetId]))
    return JSON.stringify(connectionRequest[targetId]);
}

// 챌린지를 개인키로 암호화하여 돌려줌
async function createChallengeResponse(req)
{
    req = JSON.parse(req);
    console.log("createChallengeResponse : "+getId() + "=>" + req.targetId);
    let [didForChallenge, verkeyForChallenge] = await indy.createAndStoreMyDid(wh, {});
    didForSomeone[req.targetId] = {}
    didForSomeone[req.targetId].did = didForChallenge;
    didForSomeone[req.targetId].key = verkeyForChallenge;

    console.log(JSON.stringify(didForSomeone))

    didFromSomeone[req.targetId] = {}
    didFromSomeone[req.targetId].did = req.did;
    didFromSomeone[req.targetId].key = await indy.keyForDid(ph, wh, req.did);

    let connectionResponse = JSON.stringify({
        'did': didForChallenge,
        'verkey': verkeyForChallenge,
        'nonce': req.nonce
    });
    let anoncryptedConnectionResponse = await indy.cryptoAnonCrypt(didFromSomeone[req.targetId].key, Buffer.from(connectionResponse, 'utf8'));
    let res = {};
    res.targetId = getId();
    res.encryptedRes = anoncryptedConnectionResponse;
    return res;
}

// 돌려받은 챌린지를 target의 공개키로 암호화 해제하여 챌린지를 verify함
async function verifyChallengeResponse(res)
{
    let decryptedRes = JSON.parse(Buffer.from(await indy.cryptoAnonDecrypt(wh, didForSomeone[res.targetId].key, res.encryptedRes)));

    
    console.log("createRequestForTrustAnchor2 " + getId() + "가 생성했던 nonce : "+connectionRequest[res.targetId].nonce);
    console.log("createRequestForTrustAnchor2 " + res.targetId + "가 개인키로 암호화한 nonce : " + decryptedRes.nonce);
    
    if (connectionRequest[res.targetId].nonce !== decryptedRes.nonce) {
        throw Error("nonce 매칭 안됨");
    }
    else
    {
        console.log(getId() + " => " + res.targetId + " : 챌린지 성공. 인증됨.");
    }
    
    didFromSomeone[res.targetId] = {}
    didFromSomeone[res.targetId].did = decryptedRes.did;
    didFromSomeone[res.targetId].key = decryptedRes.verkey;
    await utils.sendNym(ph, wh, did, decryptedRes.did, decryptedRes.verkey, null);
}


// TRUST_ANCHOR가 되기 위한 요청을 생성함.
async function createTrustAnchorRequest(stewardId)
{
    console.log("createTrustAnchorRequest : "+getId());
    let didInfoJson = JSON.stringify({
        'did': did,
        'verkey': verkey
    });
    console.log(didForSomeone[stewardId])
    let authcryptedDidInfo = await indy.cryptoAuthCrypt(wh, didForSomeone[stewardId].key, didFromSomeone[stewardId].key, Buffer.from(didInfoJson, 'utf8'));
    var req = {}
    req.targetId = getId();
    req.authcryptedDidInfo = authcryptedDidInfo;
    return req;
}

// TRUST_ANCHOR가 되기 위한 요청을 승인함. 사전에 challenge를 주고받을 필요가 있음.
// 해당 승인은 Steward만이 가능함.
async function acceptTrustAnchorRequest(req)
{
    let targetId = req.targetId;
    console.log("createTrustAnchorRequest : "+targetId);
    
    if (!didForSomeone[targetId] || !didFromSomeone[targetId])
        throw Error(getId() + "는 " + targetId + " 와 인증 챌린지를 완료하지 않았다")
    
    let authcryptedDidInfo = req.authcryptedDidInfo;
    
    console.log("cryptoAuthDecrypt1");
    let [senderVerkey, authdecryptedDidInfo] =
        await indy.cryptoAuthDecrypt(wh, didForSomeone[targetId].key, Buffer.from(authcryptedDidInfo));
    console.log("cryptoAuthDecrypt2");

    let authdecryptedDidInfoJson = JSON.parse(Buffer.from(authdecryptedDidInfo));
    
    console.log("keyForDid1");
    let retrievedVerkey = await indy.keyForDid(ph, wh, didFromSomeone[targetId].did);
    console.log("keyForDid2");

    if (senderVerkey !== retrievedVerkey) {
        throw Error("Verkey is not the same");
    }
    await utils.sendNym(ph, wh, did, authdecryptedDidInfoJson['did'], authdecryptedDidInfoJson['verkey'], 'TRUST_ANCHOR');

    console.log(targetId + "는 이제 TRUST_ANCHOR 다");
}

async function getCredDefId(schemaName)
{
    try
    {
        let record = await indy.getWalletRecord(wh, "cred", schemaName, {});
        return record.value;
    }
    catch (e)
    {
        return false;
    }
}

//스키마 등록은 TRUST_ANCHOR 에게만 허용된다.
//스키마 포맷은 스키마 attribute의 이름 배열의 형태를 갖는다.
let credentialDefIds = {};
let schemaIds = {};
async function createOrUpdateSchema(schemaName, schemaVersion, schemaFormat)
{
    console.log("스키마 생성 : " + schemaName);
    let alreadyCreatedId = await getCredDefId(schemaName);
    let credDefId, credDefJson;
    if (alreadyCreatedId) {
        credDefId = alreadyCreatedId;
        // // let schemaId = alreadyCreatedId;
        // // console.log("이미 존재하는 schemaId 불러옴 : " + schemaId);
        // // [scgemaId, schema] = await utils.getSchema(ph, did, schemaId);
        // // console.log(JSON.stringify(schemaId));
        // // console.log(JSON.stringify(schema));
        // try {
        //     credDefId = alreadyCreatedId;
        //     // console.log("wallet record 에서 불러오기 시도 : " + schemaId);
        //     // let record = await indy.getWalletRecord(wh, "cred", schemaName, {});
        //     // console.log(record)
        //     // credDefId = record.value;
        //     // console.log("불러온 credDefId : " + credDefId);
        //     // let credDef = await indy.getCredDef(ph, wh, did, credDefId, {});
        //     // console.log(credDef)
        //     // [credDefId, credDefJson] = await utils.getCredDef(ph, did, credDefId);
        //     // [credDefId, credDefJson] = await utils.getCredDef(ph, did, "MeF4B2edKspcYM9cesDoLA:3:CL:354:TAG1"); //MeF4B2edKspcYM9cesDoLA:3:CL:354:TAG1
        // }
        // catch (e)
        // {
        //     console.log(e)
        //     console.log("getCredDef 실패.. 새롭게 생성함")
        //     let asdf = await indy.issuerCreateAndStoreCredentialDef(wh, did, schema, 'TAG1', 'CL', '{"support_revocation": false}');
        //     console.log(asdf)
        //     credDefId = asdf[0]
        //     credDefJson = asdf[1]
        //     // [credDefId, credDefJson] = asdf;
        //     await utils.sendCredDef(ph, wh, did, credDefJson);
        //     await indy.addWalletRecord(wh, "cred", schemaId, credDefId);
        // }
        console.log("이미 생성된 credDefId 가져오기 성공 : " + credDefId);
    }
    else {
        console.log("새로운 스키마 생성");
        let [schemaId, schema] = await indy.issuerCreateSchema(did, schemaName, schemaVersion, schemaFormat);
        await utils.sendSchema(ph, wh, did, schema);
        [, schema] = await utils.getSchema(ph, did, schemaId); // 스키마의 seqNo를 가져오기 위해 필요함.. 이거때메 개삽질했다. 필요한 코드임.

        [credDefId, credDefJson] = await indy.issuerCreateAndStoreCredentialDef(wh, did, schema, 'TAG1', 'CL', '{"support_revocation": false}');
        await utils.sendCredDef(ph, wh, did, credDefJson);

        console.log("schemaId : " + schemaId)
        console.log(schema)
        console.log("credDefId : " + credDefId)
        console.log(credDefJson)
        await indy.addWalletRecord(wh, "schema", schemaName, schemaId);
        await indy.addWalletRecord(wh, "cred", schemaName, credDefId);
    }
    credentialDefIds[schemaName] = credDefId;
    credOfferJsons[schemaName] = {}
    return credDefId;
}

// 스키마에 대한 credential 요청 request를 생성한다
let credOfferJsons = {}
async function createCredentialOffer(schemaName, targetId)
{
    if (!didForSomeone[targetId] || !didFromSomeone[targetId])
        throw Error(getId() + "는 " + targetId + " 와 인증 챌린지를 완료하지 않았다")
    
    if (!credentialDefIds[schemaName])
        throw Error(getId() + "는 " + schemaName + " 스키마를 생성하지 않았다")
    
    let credDefId = credentialDefIds[schemaName];
        
    let credOfferJson = await indy.issuerCreateCredentialOffer(wh, credDefId);

    credOfferJsons[schemaName][targetId] = credOfferJson;

    let req = {}
    req.authcryptedCredOffer = await indy.cryptoAuthCrypt(wh, didForSomeone[targetId].key, didFromSomeone[targetId].key, Buffer.from(JSON.stringify(credOfferJson), 'utf8'));
    req.targetId = getId();
    req.schemaName = schemaName;
    req.credDefId = credDefId;
    return req;
}


let masterSecretIds = {}
let credOfferInfos = {}
async function createMasterSecret(req) {
    authcryptedCredOffer = req.authcryptedCredOffer;
    let [targetVerkey, authdecryptedCredOfferJson, authdecryptedCredOffer] = await utils.authDecrypt(wh, didForSomeone[req.targetId].key, authcryptedCredOffer);
    let masterSecretId = await indy.proverCreateMasterSecret(wh, null);

    masterSecretIds[req.schemaName] = masterSecretId;
    try {
        await indy.addWalletRecord(wh, "masterSecret", req.credDefId, masterSecretId);
    }
    catch
    {
        await indy.updateWalletRecordValue(wh, "masterSecret", req.credDefId, masterSecretId);
    }

    let [credDefId, credDef] = await utils.getCredDef(ph, didForSomeone[req.targetId].did, authdecryptedCredOffer.cred_def_id);
    let [credRequestJson, credRequestMetadataJson] = await indy.proverCreateCredentialReq(wh, didForSomeone[req.targetId].did, authdecryptedCredOfferJson, credDef, masterSecretId);
    let authcryptedCredRequest = await indy.cryptoAuthCrypt(wh, didForSomeone[req.targetId].key, didFromSomeone[req.targetId].key, Buffer.from(JSON.stringify(credRequestJson), 'utf8'));

    credOfferInfos[req.schemaName] = {}
    credOfferInfos[req.schemaName].credDef = credDef;
    credOfferInfos[req.schemaName].credRequestJson = credRequestJson;
    credOfferInfos[req.schemaName].credRequestMetadataJson = credRequestMetadataJson;

    var res = {}
    res.authcryptedCredRequest = authcryptedCredRequest;
    res.targetId = getId();
    res.schemaName = req.schemaName;

    return res;
}


async function createCredential(res, credValues)
{
    let [targetVerkey, authdecryptedCredRequestJson] = await utils.authDecrypt(wh, didForSomeone[res.targetId].key, res.authcryptedCredRequest);
    let [credJson] = await indy.issuerCreateCredential(wh, credOfferJsons[res.schemaName][res.targetId], authdecryptedCredRequestJson, credValues, null, -1);
    let authcryptedCredJson = await indy.cryptoAuthCrypt(wh, didForSomeone[res.targetId].key, targetVerkey, Buffer.from(JSON.stringify(credJson),'utf8'));

    let credInfo = {}
    credInfo.authcryptedCredJson = authcryptedCredJson;
    credInfo.targetId = getId();
    credInfo.schemaName = res.schemaName;

    return credInfo;
}

// credential을 wallet에 저장
async function storeCredential(credInfo)
{
    let [, authdecryptedCredJson] = await utils.authDecrypt(wh, didForSomeone[credInfo.targetId].key, credInfo.authcryptedCredJson);

    await indy.proverStoreCredential(wh, null, credOfferInfos[credInfo.schemaName].credRequestMetadataJson,
        authdecryptedCredJson, credOfferInfos[credInfo.schemaName].credDef, null);
}


async function printWallet(){
    console.log("print wallet : " + getId());
    console.log(await indy.proverGetCredentials(wh, {}));
    console.log(await indy.listMyDidsWithMeta (wh));
    console.log('');
}





let proofRequestJsons = {}
// 현재 requestName은 의미가 없음
async function createProofRequest(requestJSON, targetId)
{
    let nonce = await indy.generateNonce();
    requestJSON.nonce = nonce;
    proofRequestJsons[targetId] = requestJSON;
    let targetVerkey = await indy.keyForDid(ph, wh, didFromSomeone[targetId].did);
    let authcryptedProofRequestJson = await indy.cryptoAuthCrypt(wh, didForSomeone[targetId].key, targetVerkey, Buffer.from(JSON.stringify(requestJSON), 'utf8'));
    let req = {}
    req.targetId = getId();
    req.authcryptedProofRequestJson = authcryptedProofRequestJson;
    return req;
}

async function createProof(req)
{
    let authcryptedProofRequestJson = req.authcryptedProofRequestJson;
    let [targetVerkey, requestJsonStr] = await utils.authDecrypt(wh, didForSomeone[req.targetId].key, authcryptedProofRequestJson);
    let searchForProofRequest = await indy.proverSearchCredentialsForProofReq(wh, requestJsonStr, null);
    let requestJSON = JSON.parse(requestJsonStr)

    let credsForProof = {};
    let requested_attributes = {};
    for(var attribute in requestJSON.requested_attributes)
    {
        let credentials = await indy.proverFetchCredentialsForProofReq(searchForProofRequest, attribute, 100)
        let credForAttr = credentials[0]['cred_info'];
        credsForProof[`${credForAttr['referent']}`] = credForAttr;
        requested_attributes[attribute] = {}
        requested_attributes[attribute].cred_id = `${credForAttr['referent']}`;
        requested_attributes[attribute].revealed = true;
    }

    let [schemasJson, credDefsJson, revocStatesJson] = await utils.proverGetEntitiesFromLedger(ph, didForSomeone[req.targetId].did, credsForProof);
    let requestedCredsJson = { 'self_attested_attributes': {}, 'requested_attributes': requested_attributes, 'requested_predicates': {}};
    let credDefId = Object.keys(credDefsJson)[0];
    let masterSecretId = (await indy.getWalletRecord(wh, "masterSecret", credDefId, {})).value;
    let proofJson = await indy.proverCreateProof(wh, requestJsonStr, requestedCredsJson, masterSecretId, schemasJson, credDefsJson, revocStatesJson);
    let authcryptedProofJson = await indy.cryptoAuthCrypt(wh, didForSomeone[req.targetId].key, targetVerkey, Buffer.from(JSON.stringify(proofJson), 'utf8'));
    let proof = {}
    proof.targetId = getId();
    proof.authcryptedProofJson = authcryptedProofJson;
    return proof;
}

async function verifyProof(proof){
    let decryptedProofJson, decryptedProof;
    [, decryptedProofJson, decryptedProof] = await utils.authDecrypt(wh, didForSomeone[proof.targetId].key, proof.authcryptedProofJson);

    let schemasJson, credDefsJson, revocRefDefsJson, revocRegsJson;
    [schemasJson, credDefsJson, revocRefDefsJson, revocRegsJson] = await utils.verifierGetEntitiesFromLedger(ph, did, decryptedProof['identifiers']);

    let result = await indy.verifierVerifyProof(proofRequestJsons[proof.targetId], decryptedProofJson, schemasJson, credDefsJson, revocRefDefsJson, revocRegsJson) 
    return result;
}


module.exports = 
{
    init,
    getId,
    createChallenge,
    createChallengeResponse,
    verifyChallengeResponse,
    createTrustAnchorRequest,
    acceptTrustAnchorRequest,
    getCredDefId,
    createOrUpdateSchema,
    createCredentialOffer,
    createMasterSecret,
    createCredential,
    storeCredential,
    printWallet,

    createProofRequest,
    createProof,
    verifyProof,
}



