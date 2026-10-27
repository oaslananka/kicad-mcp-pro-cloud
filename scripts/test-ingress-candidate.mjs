import assert from "node:assert/strict";
import {test} from "node:test";
import {assertIngressCandidate} from "./ingress-candidate-contract.mjs";

const env={
  KICAD_INGRESS_APP_IP:"10.255.242.3",
  KICAD_INGRESS_PROXY_IP:"10.255.242.2",
  KICAD_INGRESS_SUBNET:"10.255.242.0/29"
};
function valid(){
  return {
    name:"kicad-cloud",
    services:{
      app:{
        image:"kicad-mcp-pro-cloud:production",
        environment:{AUTH_MODE:"external"},
        networks:{database:{},ingress_private:{ipv4_address:env.KICAD_INGRESS_APP_IP}},
        read_only:true,cap_drop:["ALL"]
      },
      db:{
        networks:{database:{}},
        volumes:[{type:"volume",target:"/var/lib/postgresql/data"}]
      },
      cloudflared_kicad:{
        networks:{ingress_private:{ipv4_address:env.KICAD_INGRESS_PROXY_IP},
          connector_egress:{}},
        read_only:true,cap_drop:["ALL"],user:"65532:65532",
        command:["tunnel","--no-autoupdate","run","--token-file",
          "/run/secrets/kicad_tunnel_token"],
        secrets:[{source:"kicad_tunnel_token"}]
      }
    },
    networks:{
      database:{internal:true},
      ingress_private:{internal:true,ipam:{config:[{subnet:env.KICAD_INGRESS_SUBNET}]}},
      connector_egress:{internal:false}
    },
    secrets:{kicad_tunnel_token:{environment:"KICAD_CLOUDFLARE_TUNNEL_TOKEN"}}
  };
}
test("a clean, private KiCad-only ingress model satisfies the offline contract",()=>{
  const model=valid();
  assert.doesNotThrow(()=>assertIngressCandidate(model,env,JSON.stringify(model)));
});
const scenarios=[
  ["re-introduces shared ops_internal network",m=>{
    m.networks.tunnel={name:"ops_internal",external:true};
  }],
  ["app accidentally re-joins a third network",m=>{
    m.services.app.networks.ops_internal={};
  }],
  ["connector silently reuses shared egress",m=>{
    m.services.cloudflared_kicad.networks.ops_internal={};
  }],
  ["tunnel TCP peer loses static IP",m=>{
    delete m.services.cloudflared_kicad.networks.ingress_private.ipv4_address;
  }],
  ["app loses static IP",m=>{
    delete m.services.app.networks.ingress_private.ipv4_address;
  }],
  ["ingress bridge can reach the Internet",m=>{
    m.networks.ingress_private.internal=false;
  }],
  ["extra published port leaks app",m=>{
    m.services.app.ports=["8787:8787"];
  }],
  ["container unexpectedly becomes writable",m=>{
    m.services.app.read_only=false;
  }],
  ["connector receives dangerous elevated capabilities",m=>{
    m.services.cloudflared_kicad.cap_drop=[];
  }],
  ["connector token inserted in the command",m=>{
    m.services.cloudflared_kicad.command=["tunnel","run","--token","secret"];
  }],
  ["connector secret comes from a different variable",m=>{
    m.secrets.kicad_tunnel_token.environment="SHARED_TUNNEL_TOKEN";
  }],
  ["OAuth mode silently changes",m=>{
    m.services.app.environment.AUTH_MODE="builtin";
  }],
  ["device API is enabled before acceptance",m=>{
    m.services.app.environment.PAIRING_DEVICE_API_ENABLED="true";
  }],
  ["WebSocket API enabled before acceptance",m=>{
    m.services.app.environment.CONNECTOR_WS_ENABLED="true";
  }],
  ["persistent database volume replaced",m=>{
    m.services.db.volumes=[];
  }]
];
for(const [name,mutate] of scenarios){
  test("candidate contract rejects when "+name,()=>{
    const m=valid();
    mutate(m);
    assert.throws(()=>assertIngressCandidate(m,env,JSON.stringify(m)));
  });
}
