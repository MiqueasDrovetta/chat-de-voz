// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCjrh6_Pd9vb3YXMyNeDkBcamN5o6zOb5I",
  authDomain: "chatdevoz-backend.firebaseapp.com",
  databaseURL: "https://chatdevoz-backend-default-rtdb.firebaseio.com",
  projectId: "chatdevoz-backend",
  storageBucket: "chatdevoz-backend.firebasestorage.app",
  messagingSenderId: "563146717008",
  appId: "1:563146717008:web:d89b9d742be403d80a9e55",
  measurementId: "G-F9L2QR1BJH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
