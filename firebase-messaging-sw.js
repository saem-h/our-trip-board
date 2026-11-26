/* Our Trip Board 서비스 워커: 알림 받기 (Firebase Cloud Messaging) + 홈 화면 앱 설치 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

self.addEventListener('install',function(){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());});

/* 안드로이드(크롬·삼성 인터넷)가 '앱'으로 설치하려면 페이지 요청을 처리하는 코드가 있어야 해요.
   저장(캐시)은 하지 않고 그대로 인터넷에서 받아요. */
self.addEventListener('fetch',function(e){
  if(e.request.mode!=='navigate')return;
  e.respondWith(fetch(e.request));
});

/* 알림은 직접 보여 줘요: 상태 표시줄 아이콘(badge)은 흰 점, 누르면 그 보드를 열어요.
   (Firebase 기본 처리보다 먼저 받아서 두 번 뜨지 않게 해요) */
/* 애플 사파리(웹킷) 여부: 크롬·엣지·파이어폭스·안드로이드가 아닌 Safari */
var UA=(self.navigator&&self.navigator.userAgent)||'';
var APPLE=/Safari/.test(UA)&&!/Chrome|Chromium|CriOS|Edg|FxiOS|Firefox|Android/.test(UA);
self.addEventListener('push',function(e){
  var j={};try{j=e.data?e.data.json():{};}catch(x){}
  var n=j.notification||{},d=j.data||{};
  if(!n.title&&!n.body&&!d.title)return;
  e.stopImmediatePropagation();
  var link=(j.fcmOptions&&j.fcmOptions.link)||d.link||'/';
  var title=n.title||d.title||'Our Trip Board',body=n.body||d.body||'';
  /* 앱을 보고 있는 중이면 알림 대신 화면 안 토스트로 알려요.
     단, 아이폰·아이패드·맥 사파리는 알림을 안 띄우면 알림 권한을 꺼 버릴 수 있어서 항상 띄워요. */
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
    var vis=cs.filter(function(c){return c.visibilityState==='visible';});
    if(vis.length&&!APPLE){vis.forEach(function(c){c.postMessage({tbPush:{title:title,body:body}});});return;}
    return self.registration.showNotification(title,{body:body,icon:'/icon-192.png',badge:'/badge-96.png',tag:j.messageId||j.fcmMessageId||undefined,data:{link:link}});
  }));
});
self.addEventListener('notificationclick',function(e){
  var link=(e.notification.data&&e.notification.data.link)||'/';
  e.notification.close();
  var url=new URL(link,self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
    for(var i=0;i<cs.length;i++){var c=cs[i];if(c.url===url&&'focus' in c)return c.focus();}
    for(var k=0;k<cs.length;k++){var c2=cs[k];if(new URL(c2.url).origin===self.location.origin&&'navigate' in c2)return c2.navigate(url).then(function(w){return w&&w.focus();});}
    return self.clients.openWindow(url);
  }));
});

firebase.initializeApp({apiKey:"AIzaSyBDhfwIua7W4lsi4dSoW45fSAOrOo4FsSk",authDomain:"our-trip-board.firebaseapp.com",projectId:"our-trip-board",storageBucket:"our-trip-board.firebasestorage.app",messagingSenderId:"322253671318",appId:"1:322253671318:web:499a937d19c73df4dfabb7"});
firebase.messaging();
