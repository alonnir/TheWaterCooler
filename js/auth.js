auth.onAuthStateChanged((user) => {
  if (user) {
    window.location.href = "app.html";
    return;
  }
  showErrorFromQuery();
});

const signInButton = document.getElementById("google-signin-btn");
if (signInButton) {
  signInButton.addEventListener("click", async () => {
    clearError();
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      const result = await auth.signInWithPopup(provider);
      const user = result.user;
      if (!user) {
        showError("Could not complete sign-in.");
        return;
      }

      await db.collection("users").doc(user.uid).set(
        {
          email: user.email || "",
          displayName: user.displayName || "",
          photoURL: user.photoURL || "",
          lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      showError(`Sign-in failed: ${error.message}`);
    }
  });
}

function showError(message) {
  const errorDiv = document.getElementById("error-message");
  if (errorDiv) {
    errorDiv.textContent = message;
  }
}

function clearError() {
  const errorDiv = document.getElementById("error-message");
  if (errorDiv) {
    errorDiv.textContent = "";
  }
}

function showErrorFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get("reason");
  if (reason === "not-approved") {
    showError("This account is not approved for access.");
  }
}
