document.getElementById("clear-storage").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      try {
        const url = new URL(tabs[0].url);
        const hostname = url.hostname;
        if (hostname) {
          chrome.storage.local.remove(hostname, () => {
            // Send a reload message or simply alert/show toast
            const btn = document.getElementById("clear-storage");
            const originalText = btn.textContent;
            btn.textContent = "Cleared!";
            btn.style.background = "#059669";
            btn.style.borderColor = "#10b981";
            btn.style.color = "#fff";
            setTimeout(() => {
              btn.textContent = originalText;
              btn.style.background = "";
              btn.style.borderColor = "";
              btn.style.color = "";
            }, 1500);

            // Notify active tab to reload or reset styles immediately if possible
            chrome.tabs.sendMessage(
              tabs[0].id,
              { action: "reset_styles" },
              () => {
                // Ignore potential errors if script is not injected on this special page (e.g. chrome://)
                if (chrome.runtime.lastError) {
                  // Keep quiet
                }
              },
            );
          });
        }
      } catch (e) {
        // Active tab has invalid url structure (e.g., chrome://extensions)
        const btn = document.getElementById("clear-storage");
        btn.textContent = "Unavailable Here";
        setTimeout(() => {
          btn.textContent = "Reset Current Site";
        }, 1500);
      }
    }
  });
});
