/**
 * Read-only Cloud deployment acceptance helper. This is a conservative
 * necessary-condition check, NOT a proof of Cloudflare edge authenticity.
 */
import {isIP} from "node:net";

export type DockerEndpoint={
  IPAddress?:string;
  IPAMConfig?:{IPv4Address?:string}|null;
};
export type DockerContainerSnapshot={
  Id:string;
  Name:string;
  HostConfig:{
    NetworkMode?:string;
    PortBindings?:Record<string,unknown>|null;
    Privileged?:boolean;
    CapAdd?:string[]|null;
    CapDrop?:string[]|null;
    SecurityOpt?:string[]|null;
  };
  NetworkSettings:{Networks:Record<string,DockerEndpoint>};
};
export type DockerNetworkSnapshot={
  Name:string;
  Driver:string;
  Internal:boolean;
  Attachable?:boolean;
  Containers?:Record<string,{Name:string}>;
};
export type IngressTopology={
  app:DockerContainerSnapshot;
  proxy:DockerContainerSnapshot;
  networks:DockerNetworkSnapshot[];
  privateNetwork:string;
  expectedProxyIp:string;
};
export type IngressFinding =
  "INVALID_INVENTORY"|"PRIVATE_NETWORK_MISSING"|"NETWORK_NOT_PRIVATE_BRIDGE"|
  "NETWORK_ATTACHABLE"|"OTHER_INGRESS_MEMBERS"|"APP_MISSING_FROM_INGRESS"|
  "PROXY_MISSING_FROM_INGRESS"|"APP_IP_NOT_FIXED"|"PROXY_IP_NOT_FIXED"|
  "PROXY_IP_MISMATCH"|"APP_HAS_PUBLISHED_PORTS"|"APP_PRIVILEGED"|
  "APP_EXTRA_CAPABILITIES"|"APP_NO_CAP_DROP_ALL"|"APP_HAS_NONPRIVATE_NETWORK"|
  "APP_HAS_UNVERIFIED_NETWORK"|"APP_NETWORK_MODE_UNSAFE"|
  "PROXY_NETWORK_MODE_UNSAFE";

export type IngressTopologyReport={
  verdict:"BLOCKED"|"PREREQUISITES_MET";
  findings:IngressFinding[];
};

function fixedIpv4(endpoint:DockerEndpoint|undefined):string|null{
  const assigned=endpoint?.IPAddress;
  const pinned=endpoint?.IPAMConfig?.IPv4Address?.split("/")[0];
  if(!assigned||!pinned||isIP(pinned)!==4||assigned!==pinned)return null;
  return pinned;
}

/**
 * Required conditions:
 * - app + its dedicated cloudflared connector alone can join the private
 *   non-attachable bridge, each with an explicitly pinned source address.
 * - app has no published ports, elevated privileges, cap additions, or
 *   Docker host/container network mode.
 * - app's *other* networks must also be internal bridges.
 *
 * Doesn't validate Cloudflare WAF, header rewriting, Worker configuration,
 * firewall, external Docker admin access, or real TLS: separate gates.
 */
export function inspectIngressTopology(topology:IngressTopology):IngressTopologyReport{
  const errors=new Set<IngressFinding>();
  const {app,proxy,privateNetwork,networks,expectedProxyIp}=topology;
  if(!app?.Id||!proxy?.Id||app.Id===proxy.Id||
     !privateNetwork||isIP(expectedProxyIp)!==4){
    return {verdict:"BLOCKED",findings:["INVALID_INVENTORY"]};
  }
  const byName=new Map(networks.map(n=>[n.Name,n]));
  const isolated=byName.get(privateNetwork);
  if(!isolated)errors.add("PRIVATE_NETWORK_MISSING");
  else{
    if(isolated.Driver!=="bridge"||isolated.Internal!==true)
      errors.add("NETWORK_NOT_PRIVATE_BRIDGE");
    if(isolated.Attachable===true)errors.add("NETWORK_ATTACHABLE");
    const members=new Set(Object.keys(isolated.Containers??{}));
    if(!members.has(app.Id))errors.add("APP_MISSING_FROM_INGRESS");
    if(!members.has(proxy.Id))errors.add("PROXY_MISSING_FROM_INGRESS");
    if(members.size!==2||[...members].some(id=>id!==app.Id&&id!==proxy.Id))
      errors.add("OTHER_INGRESS_MEMBERS");
  }
  const appEndpoint=app.NetworkSettings.Networks[privateNetwork];
  const proxyEndpoint=proxy.NetworkSettings.Networks[privateNetwork];
  if(!fixedIpv4(appEndpoint))errors.add("APP_IP_NOT_FIXED");
  const proxyIp=fixedIpv4(proxyEndpoint);
  if(!proxyIp)errors.add("PROXY_IP_NOT_FIXED");
  if(proxyIp&&proxyIp!==expectedProxyIp)errors.add("PROXY_IP_MISMATCH");
  for(const network of Object.keys(app.NetworkSettings.Networks)){
    if(network===privateNetwork)continue;
    const details=byName.get(network);
    if(!details)errors.add("APP_HAS_UNVERIFIED_NETWORK");
    else if(details.Internal!==true||details.Driver!=="bridge")
      errors.add("APP_HAS_NONPRIVATE_NETWORK");
  }
  for(const [c,label] of [[app,"APP_NETWORK_MODE_UNSAFE"],[proxy,"PROXY_NETWORK_MODE_UNSAFE"]] as const){
    const mode=c.HostConfig.NetworkMode??"";
    if(mode==="host"||mode==="none"||mode.startsWith("container:"))
      errors.add(label);
  }
  if(Object.values(app.HostConfig.PortBindings??{}).some(x=>x!==null))
    errors.add("APP_HAS_PUBLISHED_PORTS");
  if(app.HostConfig.Privileged)errors.add("APP_PRIVILEGED");
  if((app.HostConfig.CapAdd??[]).length)errors.add("APP_EXTRA_CAPABILITIES");
  if(!(app.HostConfig.CapDrop??[]).includes("ALL"))
    errors.add("APP_NO_CAP_DROP_ALL");
  const findings=[...errors].sort();
  return {verdict:findings.length?"BLOCKED":"PREREQUISITES_MET",findings};
}
