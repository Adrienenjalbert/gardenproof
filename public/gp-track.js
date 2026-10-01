/*! GardenProof tracker - first-party storage, no cookies (see plugin readme) */
(function(w,d){
var s=d.currentScript,c=w.GP_TRACK||{},A=function(n){return s&&s.getAttribute("data-"+n)||""};
var app=(c.appUrl||A("app-url")).replace(/\/$/,""),ten=c.tenant||A("tenant");
var L=w.localStorage,S=w.sessionStorage,l=w.location,U=["source","medium","campaign","content","term"];
function g(st,k){try{return JSON.parse(st.getItem(k))}catch{return null}}
function p(st,k,v){try{st.setItem(k,JSON.stringify(v))}catch{}}
var q=new URLSearchParams(l.search),r=d.referrer||"",ext=!!r&&r.indexOf(l.origin)!==0,tag=0;
var t={landingPage:l.href.split("#")[0].slice(0,2e3),referrer:ext?r.slice(0,2e3):"",ts:Date.now()};
U.forEach(function(k){var v=q.get("utm_"+k);if(v){t[k]=v;tag=1}});
["gclid","fbclid"].forEach(function(k){var v=q.get(k);if(v){t[k]=v;tag=1}});
if(!g(L,"gp_ft"))p(L,"gp_ft",t);
if(tag||!g(L,"gp_lt")||(ext&&!g(S,"gp_s")))p(L,"gp_lt",t);
p(S,"gp_s",1);
var pe=d.querySelector("[data-gp-project]"),m=l.pathname.match(/\/projects\/([a-z0-9-]+)/i);
var slug=pe?pe.getAttribute("data-gp-project"):m&&m[1];
if(slug)p(L,"gp_proj",slug);
function fields(){
var f=g(L,"gp_ft")||{},z=g(L,"gp_lt")||{},o={};
U.forEach(function(k){o["gp_utm_"+k]=f[k]||""});
o.gp_gclid=z.gclid||f.gclid||"";o.gp_fbclid=z.fbclid||f.fbclid||"";
o.gp_landing=f.landingPage||"";o.gp_referrer=f.referrer||"";o.gp_project=g(L,"gp_proj")||"";
return o}
function inject(f){
var o=fields();
Object.keys(o).forEach(function(n){var i=f.querySelector('input[name="'+n+'"]');
if(!i){i=d.createElement("input");i.type="hidden";i.name=n;f.appendChild(i)}i.value=o[n]});
if(!f.querySelector('[name="gp_hp"]')){var h=d.createElement("input");
h.name="gp_hp";h.tabIndex=-1;h.autocomplete="off";h.setAttribute("aria-hidden","true");
h.hidden=true;f.appendChild(h)}}
var M={name:/name/i,email:/mail/i,phone:/phone|tel|mobile/i,postcode:/post.?code|zip/i,
service:/service|interest/i,message:/message|enquiry|details|comment/i};
function lead(pairs){var o={};
pairs.forEach(function(x){var n=x.name||"",v=x.value;if(typeof v!="string")return;
if(n=="gp_hp"){o.hp=v;return}if(/^(_|gp_)/.test(n))return;
for(var k in M)if(!o[k]&&M[k].test(n)){o[k]=v.trim();break}});
return o}
function send(o){if(!app)return;
o.tenant=ten||void 0;o.first=g(L,"gp_ft")||void 0;o.last=g(L,"gp_lt")||void 0;o.projectSlug=g(L,"gp_proj")||void 0;
try{fetch(app+"/api/leads"+(ten?"?tenant="+encodeURIComponent(ten):""),{method:"POST",body:JSON.stringify(o),keepalive:true})}catch{}}
var SEL="form.wpcf7-form,form[data-gp-lead]";
function scan(){[].forEach.call(d.querySelectorAll(SEL),inject)}
if(d.readyState=="loading")d.addEventListener("DOMContentLoaded",scan);else scan();
d.addEventListener("submit",function(e){var f=e.target;if(!f.matches||!f.matches(SEL))return;inject(f);
if(f.hasAttribute("data-gp-lead"))send(lead(Array.from(new FormData(f)).map(function(x){return{name:x[0],value:x[1]}})))},true);
d.addEventListener("wpcf7mailsent",function(e){send(lead(e.detail&&e.detail.inputs||[]))});
})(window,document);
