/** Isolated browser-test harness. Never import from production startup. */
import {Pool} from 'pg'
import express from 'express'
import {writeFile} from 'node:fs/promises'
import {createAccountAuth} from '../../src/lib/account-auth'
import {createAdminRouter} from '../../src/admin/router'
import {createAdminRepository} from '../../src/admin/repository'
const value=process.env.HAWCONNECT_ADMIN_TEST_DATABASE_URL
if(!value)throw Error('IsolatedTestDatabaseRequired')
const url=new URL(value)
if(url.hostname!=='127.0.0.1'||url.pathname!=='/hawconnect_dash_test')throw Error('IsolatedTestDatabaseRequired')
const origin=process.env.HAWCONNECT_TEST_DASH_ORIGIN??'http://localhost:43127'
if(!['http://localhost:43127','http://localhost:43129'].includes(origin))throw Error('IsolatedTestOriginRequired')
const pool=new Pool({connectionString:value})
const auth=createAccountAuth({pool,passwordLogin:true,secret:'isolated-browser-test-secret-more-than-thirty-two-characters',baseURL:'http://localhost:43128',webOrigin:origin,send:async m=>{await writeFile('/tmp/hawconnect-dash-test-mail.json',JSON.stringify(m),{mode:0o600})}})
const app=express()
app.use('/api/admin',createAdminRouter({origin,auth,repository:createAdminRepository(pool,['maintainer@haw-hamburg.de']),status:async()=>[{name:'Food (Testdaten)',available:true,stale:false,updatedAt:new Date().toISOString()},{name:'Semesterzeiten (Testdaten)',available:true,stale:true,updatedAt:'2026-10-20T00:00:00Z'},{name:'HAW Events (Testdaten)',available:false,stale:true,updatedAt:null}]}))
app.listen(43128,'127.0.0.1',()=>console.log('Isolated dashboard test backend ready on 43128; no real email delivery'))
