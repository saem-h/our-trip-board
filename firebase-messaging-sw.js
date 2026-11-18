/* Our Trip Board 알림 받기 (Firebase Cloud Messaging) */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:"AIzaSyBDhfwIua7W4lsi4dSoW45fSAOrOo4FsSk",authDomain:"our-trip-board.firebaseapp.com",projectId:"our-trip-board",storageBucket:"our-trip-board.firebasestorage.app",messagingSenderId:"322253671318",appId:"1:322253671318:web:499a937d19c73df4dfabb7"});
firebase.messaging();
