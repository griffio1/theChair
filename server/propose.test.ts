import test from "node:test";
import assert from "node:assert/strict";
import { proposeContract, ProposalInputError, validateProposal } from "./propose";

const valid = () => ({contract:{id:"auth-login",name:"Login",method:"POST",path:"/api/auth/login",request:[{name:"email",type:"string",required:true}],response:[{name:"userId",type:"string",required:true}]},proposedBy:"Carter"});

test("proposal validation bounds and normalizes the existing shape and discards untrusted metadata", () => {
  const input = valid();
  const result = validateProposal({...input,contract:{...input.contract,name:" Login ",version:99,status:"approved",owner:" Carter ",notes:"Details",extra:"ignored"},reason:"Initial agreement"});
  assert.equal(result.contract.name,"Login");
  assert.equal(result.contract.owner,"Carter");
  assert.equal(result.contract.notes,"Details");
  assert.equal(result.reason,"Initial agreement");
  assert.equal("version" in result.contract,false);
  assert.equal("status" in result.contract,false);
  assert.equal("extra" in result.contract,false);
  assert.notEqual(result.contract.request,input.contract.request);
  assert.equal(validateProposal({...input,contract:{...input.contract,path:"/api/workspaces/:workspaceId",request:[],response:[]}}).contract.path,"/api/workspaces/:workspaceId");
});

test("malformed shapes cannot reach the ledger from an HTTP or model proposal", async (t) => {
  let requests = 0;
  t.mock.method(globalThis,"fetch",async () => { requests++; throw new Error("Unexpected network request"); });
  const base = valid();
  const badContracts = [null,[],{},
    ...["../other","Uppercase","a".repeat(81),"bad--slug"].map(id=>({...base.contract,id})),
    ...["CONNECT","post",null].map(method=>({...base.contract,method})),
    ...["https://example.com/api","//host/api","/api?q=1","/api#fragment","/api/../secret","/api/a b","/"+"a".repeat(1024)].map(path=>({...base.contract,path})),
    {...base.contract,name:""},{...base.contract,name:"a".repeat(121)},
    ...[null,{},"email",Array(101).fill({name:"email",type:"string",required:true}),
      [null],[{name:"email",type:"string"}],[{name:"email",type:"string",required:"true"}],
      [{name:"email",type:"invalid",required:true}],[{name:"",type:"string",required:true}],
      [{name:"a".repeat(129),type:"string",required:true}],
      [{name:"email",type:"string",required:true},{name:"email",type:"string",required:false}],
    ].flatMap(fields=>[{...base.contract,request:fields},{...base.contract,response:fields}]),
    {...base.contract,owner:{}},{...base.contract,notes:"a".repeat(4001)},
  ];
  for (const contract of badContracts)
    await assert.rejects(proposeContract({...base,contract} as any),ProposalInputError);
  for (const input of [null,[],{}, {...base,proposedBy:""},{...base,reason:{}},{...base,reason:"a".repeat(2001)}])
    await assert.rejects(proposeContract(input as any),ProposalInputError);
  assert.equal(requests,0,"no malformed proposal may read or write the database");
});
