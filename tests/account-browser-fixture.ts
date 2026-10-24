/** Isolated browser-test fixture. Never mounted by index.ts or built as a production route. */
import {readFile} from 'node:fs/promises'
import {Pool} from 'pg'
import express from 'express'
import cors from 'cors'
import {ApolloServer} from '@apollo/server'
import {expressMiddleware} from '@as-integrations/express5'
import {getMigrations} from 'better-auth/db/migration'
import {fromNodeHeaders,toNodeHandler} from 'better-auth/node'
import {createAccountAuth,getAccountOwner} from '../src/lib/account-auth'
import {createAccountSync} from '../src/lib/account-sync'
import {createAccountSyncResolvers} from '../src/lib/account-sync-resolvers'
import {createSyncCrypto} from '../src/utils/sync-crypto'

if(!process.send||!process.env.HAWCONNECT_TEST_DATABASE_URL)throw new Error('IsolatedTestRunnerRequired')
const pool=new Pool({connectionString:process.env.HAWCONNECT_TEST_DATABASE_URL})
const auth=createAccountAuth({pool,baseURL:'http://localhost:4002',webOrigin:'http://localhost:3002',secret:'isolated-browser-test-secret-only-20261023',send:async message=>{process.send?.({type:'mail',...message})}})
await(await getMigrations(auth.auth.options)).runMigrations()
await pool.query(await readFile(new URL('../src/db/accounts/sync.sql',import.meta.url),'utf8'))
const sync=createAccountSyncResolvers(createAccountSync(pool,createSyncCrypto(Buffer.alloc(32,12).toString('base64'))))
const files=['enums','scalars','types','inputs','schema']
const schema=await Promise.all(files.map(name=>readFile(new URL(`../src/schema/${name}.gql`,import.meta.url),'utf8')))
const apollo=new ApolloServer({typeDefs:schema,resolvers:{Query:{accountSnapshot:sync.accountSnapshot,food:()=>({foodData:[],errors:[],updatedAt:null,stale:true,available:false,translationFallback:false})},Mutation:{accountSync:sync.accountSync}}})
await apollo.start()
const app=express();app.use(cors({origin:'http://localhost:3002',credentials:true}))
app.all('/api/accounts/*path',(req,res,next)=>{req.headers['x-hawconnect-client-ip']=req.ip??'test';void toNodeHandler(auth.handler)(req,res).catch(next)})
app.use('/graphql',express.json({limit:'5mb'}),expressMiddleware(apollo,{context:async({req})=>({accountUserId:await getAccountOwner(auth,fromNodeHeaders(req.headers))})}))
const server=app.listen(4002,'127.0.0.1',()=>process.send?.({type:'ready'}))
process.on('message',message=>{if(message==='stop'){server.close();void apollo.stop().then(()=>pool.end()).then(()=>process.exit(0))}})
