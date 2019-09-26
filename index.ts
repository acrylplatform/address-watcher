import { utils, libs } from '@acryl/signature-generator'
import { bytesToString } from '@acryl/ts-lib-crypto'

var where = require("lodash.where");
const axios = require('axios');
var AWS = require("aws-sdk");

AWS.config.update({region: 'eu-central-1'});

var dynamoDb = new AWS.DynamoDB.DocumentClient();

// Enter ADDRESS and privateKey for check transactions type of Aset Transfer
const ADDRESS = process.env.ADDRESS;
const privateKey = process.env.privateKey;

//Get list transactions with typy of Asset Transfer (type == 4)
const getListAssetTransfer = async address => {
    const URL = `https://nodestestnet.acrylplatform.com/transactions/address/${address}/limit/100`;
    const res = await axios(URL);
    var filtered = where(res.data[0], {"type": 4});
    return filtered;
}

//Get array with objects from database
const getDataDynamoDB = new Promise((resolve, reject) => {
    dynamoDb.scan({TableName: "client"}).promise()
                    .then(data => resolve(data.Items));
});

//search every value ID from array of blockchain to array of database, method brute force
const diff = (arr1, arr2): Array<any> => {
    arr2.map(x => {
        arr1 = arr1.filter(function(item1){
            return item1.id != x.TxAssetID;
        });
    });
    return arr1;
}

//Record array with objects to database
const setDataDynamoDB = (clients, listTxAssetID) => {
    return clients.map(async (customer, index) => {
        return await new Promise((resolve, reject) => {
            var now = new Date();
            let params = {
                TableName: 'client',  
                Item: {
                    "address":      customer.address     ? customer.address: 'no value',
                    "countMiners":  customer.countMiners ? customer.countMiners: 0,
                    "country":      customer.country     ? customer.country: 'no value',
                    "countryState": customer.state       ? customer.state: 'no value',
                    "customName":   customer.name        ? customer.name: 'no value',
                    "email":        customer.email       ? customer.email: 'no value',
                    "phone":        customer.phone       ? customer.phone: 'no value',
                    "postCode":     customer.postCode    ? customer.postCode: 'no value',
                    "sity":         customer.sity        ? customer.sity: 'no value',
                    "referal":      customer.referal     ? customer.referal: 'no value',
                    "date":         now.toDateString(),
                    "TxAssetID":    listTxAssetID[index]
                }
            }
            dynamoDb.put(params, (error, data) => {
                if (error) {
                console.log(`createChatMessage ERROR=${error.stack}`);
                    resolve({
                    statusCode: 400,
                    error: `Could not create message: ${error.stack}`
                    });
        
                } else {
                    resolve({ statusCode: 200, body: JSON.stringify(params.Item) });
                }
            });
        });
    })
}

const getTransportKey = (senderPublicKey, privateKey) => {    
    const privateKeyDecode = libs.base58.decode(privateKey);
    const sellerPublicKeyDecode = libs.base58.decode(senderPublicKey);
    const sharedKey = libs.axlsign.sharedKey(privateKeyDecode, sellerPublicKeyDecode);
    const encSharedKey = libs.base58.encode(sharedKey);
    return encSharedKey;
}

const getAddressFromAttachment = item => {
    const decryptAttachment = libs.base58.decode(item);
    return bytesToString(decryptAttachment);
}

const dataDecrypt = (dataRes: any):Object => {

    const encryptedMessage = dataRes.data[0].value.toString();
    const trasportKey = getTransportKey(dataRes.senderPublicKey, privateKey);
    const decrypt = utils.crypto.decryptSeed(encryptedMessage, trasportKey, 5000);
    return JSON.parse(decrypt);

}

const getCustomerInfo = (addresses: Array<any>): Promise<object> => {

    return Promise.all(
        addresses.map(async (address: any) => {
                const url = `https://nodestestnet.acrylplatform.com/transactions/info/${address}`;
                const res = await axios(url);
                return dataDecrypt(res.data);
        })
    );
};

exports.handler = async (event, context, callback) => {
    //Generate array from Blockchain
    const dataBlockchainArray = await getListAssetTransfer(ADDRESS);
    let listTxAssetID= new Array;
    
    await getDataDynamoDB.then(result => {//return two arrays: 1) from DataBase and 2) from Blockchain        
        const dataBaseArray: any = result;
        return {dataBaseArray, dataBlockchainArray};        
    })
    .then(async ({dataBaseArray, dataBlockchainArray}) => { 
        const dataDifferent = await diff(dataBlockchainArray, dataBaseArray);
        let dataDiff = new Array;
        await dataDifferent.map(item => {
            listTxAssetID.push(item.id);
            dataDiff.push(getAddressFromAttachment(item.attachment));
        })
        return dataDiff;        
    })
    .then(dataDiff => {
        return getCustomerInfo(dataDiff);
    })
    .then((customerInfo: any) => {
        return setDataDynamoDB(customerInfo, listTxAssetID);
    })
    .then(result => console.log(result));
}