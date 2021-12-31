import * as axios from 'axios';
import * as json from '@silver886/json-schema';
import * as mongodb from 'mongodb';
import * as mongoose from 'mongoose';
import * as sdk from 'aws-sdk';
const SECRETS_MANAGER_CLIENT = new sdk.SecretsManager();

const DEFAULT_PORT = 27017;
const DEFAULT_DB = 'admin';

export class SecretsManager {
    private readonly secretId: string;

    private options: mongodb.MongoClientOptions;

    private odmOptions: mongoose.ConnectOptions;

    private arn: {
        uri: string;
        client: mongodb.MongoClient;
        odmClient: mongoose.Mongoose;
    };

    private local: {
        uri: string;
        client: mongodb.MongoClient;
        odmClient: mongoose.Mongoose;
    };

    public constructor(secretId: string) {
        this.secretId = secretId;
    }

    public get mongodbClient(): mongodb.MongoClient {
        return this.arn.client;
    }

    public get localMongodbClient(): mongodb.MongoClient {
        return this.local.client;
    }

    public get mongooseClient(): mongoose.Mongoose {
        return this.arn.odmClient;
    }

    public get localMongooseClient(): mongoose.Mongoose {
        return this.local.odmClient;
    }

    public get createMongooseConnection(): mongoose.Connection {
        return mongoose.createConnection(this.arn.uri, this.odmOptions);
    }

    public get createLocalMongooseConnection(): mongoose.Connection {
        return mongoose.createConnection(this.local.uri, this.odmOptions);
    }

    public async init(): Promise<void> {
        const getSecretValueMasterData = await SECRETS_MANAGER_CLIENT.getSecretValue({
            /* eslint-disable @typescript-eslint/naming-convention */
            SecretId: this.secretId,
            /* eslint-enable @typescript-eslint/naming-convention */
        }).promise();

        if (!getSecretValueMasterData.SecretString) throw new Error(`Secret ${this.secretId} has no value.`);

        const databaseMasterInfo = json.aws.secretsManager.database.parse(getSecretValueMasterData.SecretString, `Secret ${this.secretId}`);

        this.options = {
            useUnifiedTopology: true,
            useNewUrlParser:    true,
            auth:               {
                user:     databaseMasterInfo.username,
                password: databaseMasterInfo.password,
            },
            ...databaseMasterInfo.ssl ?
                {
                    ssl:         true,
                    sslValidate: true,
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    sslCA:       [
                        (await axios.default.get('https://s3.amazonaws.com/rds-downloads/rds-combined-ca-bundle.pem')).data,
                    ],
                    replicaSet:     'rs0',
                    readPreference: mongodb.ReadPreference.SECONDARY_PREFERRED,
                } :
                // eslint-disable-next-line no-undefined
                undefined,
        };

        this.odmOptions = {
            ...this.options,
            useCreateIndex:   true,
            useFindAndModify: false,
        };

        const baseUri = `mongodb://${databaseMasterInfo.host}:${databaseMasterInfo.port ?? DEFAULT_PORT}`;
        const arnUri = `${baseUri}/${databaseMasterInfo.dbname ?? DEFAULT_DB}?retryWrites=false`;
        const localUri = `${baseUri}/${databaseMasterInfo.localDbName ?? DEFAULT_DB}?retryWrites=false`;

        this.arn = {
            uri:       `${baseUri}/${databaseMasterInfo.dbname ?? DEFAULT_DB}?retryWrites=false`,
            client:    new mongodb.MongoClient(arnUri, this.options),
            odmClient: new mongoose.Mongoose(),
        };
        this.local = {
            uri:       `${baseUri}/${databaseMasterInfo.localDbName ?? DEFAULT_DB}?retryWrites=false`,
            client:    new mongodb.MongoClient(localUri, this.options),
            odmClient: new mongoose.Mongoose(),
        };
    }

    public async mongodbConnect(): Promise<void> {
        await this.arn.client.connect();
    }

    public async localMongodbConnect(): Promise<void> {
        await this.local.client.connect();
    }

    public async mongooseConnect(): Promise<void> {
        await this.arn.odmClient.connect(this.arn.uri, this.odmOptions);
    }

    public async localMongooseConnect(): Promise<void> {
        await this.local.odmClient.connect(this.local.uri, this.odmOptions);
    }

    public async disconnect(): Promise<void> {
        await Promise.all([
            this.arn.client.close(),
            this.local.client.close(),
            this.arn.odmClient.disconnect(),
            this.local.odmClient.disconnect(),
        ]);
    }
}
