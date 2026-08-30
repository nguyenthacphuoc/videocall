const firebaseConfig = {
    apiKey: "AIzaSyD0e5Tv4Rhw6SNadrMBvymGjoAGt8h8UuM",
    authDomain: "happy-aa62c.firebaseapp.com",
    projectId: "happy-aa62c",
    storageBucket: "happy-aa62c.firebasestorage.app",
    messagingSenderId: "109570471366",
    appId: "1:109570471366:web:eba0a4147d282d466aaec7"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();