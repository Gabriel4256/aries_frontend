const indy = require('indy-sdk');
var path = require('path');

async function getPoolHandle(poolName, poolTxnPath)
{
	let poolConfig = {
		"genesis_txn": poolTxnPath
    };

    try
    {
        //풀이 이미 존재한다면 에러가 뜬다. 존재하지 않을 수도 있으니 생성함
		await indy.createPoolLedgerConfig(poolName, poolConfig);
    }
    catch (e)
    {
        if (e.message == "PoolLedgerConfigAlreadyExistsError")
        {
            console.log("풀 존재하므로 생성하지 않음 : " + poolName)
		}
	}

    await indy.setProtocolVersion(2);
    console.log("openpooledger : " + poolName)
    return await indy.openPoolLedger(poolName, {
        timeout : 5
    });
}

//사용예 : walletConfig = {'id': 'govId'}, walletCredential = {'key': 'govKey'}
async function getWalletHandle(walletConfig, walletCredential)
{
    try
    {
        //지갑이 이미 존재한다면 에러가 뜬다. 존재하지 않을 수도 있으니 생성함
		await indy.createWallet(walletConfig, walletCredential);
    }
    catch (e)
    {
        if (e.message == "WalletAlreadyExistsError")
        {
            console.log("이미 왈렛 존재하므로 생성하지 않음 : " + walletConfig.id)
		}
	}
	return await indy.openWallet(walletConfig, walletCredential);
}

async function sendNym(poolHandle, walletHandle, Did, newDid, newKey, role)
{
    console.log("sendNym::buildNymRequest");
    let nymRequest = await indy.buildNymRequest(Did, newDid, newKey, "null", role);
    console.log("sendNym::signAndSubmitRequest");
    let req = await indy.signAndSubmitRequest(poolHandle, walletHandle, Did, nymRequest);
    console.log(req)
}

async function sendSchema(poolHandle, walletHandle, Did, schema)
{
    let schemaRequest = await indy.buildSchemaRequest(Did, schema);
    await indy.signAndSubmitRequest(poolHandle, walletHandle, Did, schemaRequest)
}

async function getSchema(poolHandle, did, schemaId) {
    console.log("getSchema")
    let getSchemaRequest = await indy.buildGetSchemaRequest(did, schemaId);
    let getSchemaResponse = await indy.submitRequest(poolHandle, getSchemaRequest);
    return await indy.parseGetSchemaResponse(getSchemaResponse);
}

async function sendCredDef(poolHandle, walletHandle, did, credDef) {
    let credDefRequest = await indy.buildCredDefRequest(did, credDef);
    await indy.signAndSubmitRequest(poolHandle, walletHandle, did, credDefRequest);
}

async function getCredDef(poolHandle, did, schemaId) {
    let getCredDefRequest = await indy.buildGetCredDefRequest(did, schemaId);
    let getCredDefResponse = await indy.submitRequest(poolHandle, getCredDefRequest);
    return await indy.parseGetCredDefResponse(getCredDefResponse);
}

async function authDecrypt(walletHandle, key, message) {
    let [fromVerkey, decryptedMessageJsonBuffer] = await indy.cryptoAuthDecrypt(walletHandle, key, message);
    let decryptedMessage = JSON.parse(decryptedMessageJsonBuffer);
    let decryptedMessageJson = JSON.stringify(decryptedMessage);
    return [fromVerkey, decryptedMessageJson, decryptedMessage];
}

async function proverGetEntitiesFromLedger(poolHandle, did, identifiers) {
    let schemas = {};
    let credDefs = {};
    let revStates = {};

    for(let referent of Object.keys(identifiers)) {
        let item = identifiers[referent];
        let [receivedSchemaId, receivedSchema] = await getSchema(poolHandle, did, item['schema_id']);
        schemas[receivedSchemaId] = receivedSchema;

        let [receivedCredDefId, receivedCredDef] = await getCredDef(poolHandle, did, item['cred_def_id']);
        credDefs[receivedCredDefId] = receivedCredDef;
    }

    return [schemas, credDefs, revStates];
}


async function verifierGetEntitiesFromLedger(poolHandle, did, identifiers) {
    let schemas = {};
    let credDefs = {};
    let revRegDefs = {};
    let revRegs = {};

    for(let referent of Object.keys(identifiers)) {
        let item = identifiers[referent];
        let [receivedSchemaId, receivedSchema] = await getSchema(poolHandle, did, item['schema_id']);
        schemas[receivedSchemaId] = receivedSchema;

        let [receivedCredDefId, receivedCredDef] = await getCredDef(poolHandle, did, item['cred_def_id']);
        credDefs[receivedCredDefId] = receivedCredDef;

        if (item.rev_reg_seq_no) {
            // TODO Get Revocation Definitions and Revocation Registries
        }
    }

    return [schemas, credDefs, revRegDefs, revRegs];
}

module.exports =
{
    getPoolHandle,
    getWalletHandle,
    sendNym,
    sendSchema,
    getSchema,
    sendCredDef,
    getCredDef,
    authDecrypt,
    proverGetEntitiesFromLedger,
    verifierGetEntitiesFromLedger
}