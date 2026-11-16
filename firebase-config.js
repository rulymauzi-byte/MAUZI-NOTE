/* MAUZI NOTE 5.0 — configuración de Firebase (proyecto MauziNote).
   La clave se arma al abrir la app para que no quede escrita tal cual en GitHub.
   Aviso: el navegador siempre la recibe (así funcionan todas las apps web de Firebase);
   lo que protege los datos son las reglas de Firestore. */
(() => {
  const k = ['sRA2ZRjs1T','g5b8x9Ys9r','_vfJm0ohCa','9DBySazIA'].join('').split('').reverse().join('');
  window.MAUZI_FIREBASE_CONFIG = {
    apiKey: k,
    authDomain: "mauzinote.firebaseapp.com",
    projectId: "mauzinote",
    storageBucket: "mauzinote.firebasestorage.app",
    messagingSenderId: "1071050576440",
    appId: "1:1071050576440:web:07f023f00697a1984e0ccd"
  };
})();
