// Replace with your Firebase project's web app config from the Firebase Console.
const firebaseConfig = {
    apiKey: "AIzaSyCb7TJyb_8N1oahpUR6HBfSGYs_XypNSHM",
    authDomain: "studio-9802056980-2f91e.firebaseapp.com",
    projectId: "studio-9802056980-2f91e",
    storageBucket: "studio-9802056980-2f91e.firebasestorage.app",
    messagingSenderId: "32565168670",
    appId: "1:32565168670:web:bbca7d95c0e9568ef8fc0f"
  };
  
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Optional: set your NewsAPI key here to enable NewsAPI sources.
const newsApiKey = "";

window.auth = auth;
window.db = db;
window.newsApiKey = newsApiKey;
