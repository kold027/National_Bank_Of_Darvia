let html5QrCode;
let currentUser;

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    fetchUserData();
    fetchPendingTransfers();
    checkUrlParams();

    // Event Listeners
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = 'login.html';
    });

    document.getElementById('transfer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const recipient_id = document.getElementById('recipient_id').value;
        const amount = document.getElementById('amount').value;

        const res = await fetch('/api/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient_id, amount })
        });

        const data = await res.json();
        if (res.ok) {
            alert(data.message);
            document.getElementById('transfer-form').reset();
        } else {
            alert(data.error);
        }
    });

    document.getElementById('show-qr-btn').addEventListener('click', () => {
        showMyQR();
    });

    document.getElementById('scan-qr-btn').addEventListener('click', () => {
        startScanner();
    });

    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

    // Admin Listeners
    document.getElementById('admin-add-money-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const recipient_id = document.getElementById('admin_target_id').value;
        const amount = document.getElementById('admin_amount').value;

        const res = await fetch('/api/admin/add-money', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient_id, amount })
        });

        const data = await res.json();
        if (res.ok) {
            alert(data.message);
            document.getElementById('admin-add-money-form').reset();
            fetchAdminUsers(); // Refresh list to see new balances
            fetchUserData(); // Refresh own balance if Larry injected into himself
        } else {
            alert(data.error);
        }
    });
});

function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const recipient = params.get('recipient');
    if (recipient && recipient.length === 6) {
        document.getElementById('recipient_id').value = recipient;
        // Clean up URL without refreshing
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

async function fetchUserData() {
    const res = await fetch('/api/user');
    if (res.status === 401) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = await res.json();
    document.getElementById('user-display').textContent = `Welcome, ${currentUser.full_name}`;
    
    const balanceEl = document.getElementById('balance-display');
    balanceEl.textContent = currentUser.balance.toLocaleString(undefined, {minimumFractionDigits: 2});
    
    // Apply red color to numeric balance if negative
    if (currentUser.balance < 0) {
        balanceEl.classList.add('neg-balance');
    } else {
        balanceEl.classList.remove('neg-balance');
    }

    document.getElementById('id-display').textContent = currentUser.id;
    document.getElementById('latest-tx-display').textContent = currentUser.latest_transaction;

    // Show Admin Panel if applicable
    if (currentUser.is_admin) {
        document.getElementById('admin-panel').style.display = 'block';
        fetchAdminUsers();
    }
}

async function fetchAdminUsers() {
    const res = await fetch('/api/admin/users');
    if (!res.ok) return;
    const users = await res.json();
    const tbody = document.getElementById('admin-user-list');
    tbody.innerHTML = '';

    users.forEach(u => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #eee';
        tr.innerHTML = `
            <td style="padding: 0.8rem;">${u.id}</td>
            <td style="padding: 0.8rem;">${u.full_name}</td>
            <td style="padding: 0.8rem;">${u.email}</td>
            <td style="padding: 0.8rem; font-weight: bold;" class="${u.balance < 0 ? 'neg-balance' : ''}">
                £${u.balance.toLocaleString(undefined, {minimumFractionDigits: 2})}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function fetchPendingTransfers() {
    const res = await fetch('/api/transfers/pending');
    const transfers = await res.json();
    const list = document.getElementById('pending-transfers-list');
    
    if (transfers.length === 0) {
        list.innerHTML = '<p>No pending transfers.</p>';
        return;
    }

    list.innerHTML = '';
    transfers.forEach(t => {
        const div = document.createElement('div');
        div.className = 'pending-transfer';
        div.innerHTML = `
            <div>
                <strong>From: ${t.sender_name}</strong><br>
                <span>Amount: £${t.amount.toFixed(2)}</span>
            </div>
            <div>
                <button class="btn btn-success btn-sm" onclick="respondTransfer(${t.id}, 'accept')">Accept</button>
                <button class="btn btn-danger btn-sm" onclick="respondTransfer(${t.id}, 'decline')">Decline</button>
            </div>
        `;
        list.appendChild(div);
    });
}

async function respondTransfer(transfer_id, action) {
    const res = await fetch('/api/transfers/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transfer_id, action })
    });

    const data = await res.json();
    if (res.ok) {
        alert(data.message);
        fetchUserData(); // Refresh balance and latest tx
        fetchPendingTransfers(); // Refresh list
    } else {
        alert(data.error);
    }
}

// --- Theme Functions ---

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeBtn(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeBtn(newTheme);
}

function updateThemeBtn(theme) {
    const btn = document.getElementById('theme-toggle-btn');
    if (theme === 'dark') {
        btn.innerHTML = '✹ Light mode';
    } else {
        btn.innerHTML = '⏾ Dark mode';
    }
}

// --- QR Functions ---

function showMyQR() {
    const modal = document.getElementById('qr-modal');
    const qrContainer = document.getElementById('qrcode');
    const linkInput = document.getElementById('qr-link-text');
    qrContainer.innerHTML = ''; // Clear previous
    
    // Generate full URL for "Smart" scanning
    const smartUrl = `${window.location.origin}${window.location.pathname}?recipient=${currentUser.id}`;
    linkInput.value = smartUrl;

    new QRCode(qrContainer, {
        text: smartUrl,
        width: 200,
        height: 200,
        colorDark: "#003366",
        colorLight: "#ffffff",
    });

    modal.style.display = 'block';
}

document.getElementById('copy-link-btn').addEventListener('click', () => {
    const linkInput = document.getElementById('qr-link-text');
    linkInput.select();
    linkInput.setSelectionRange(0, 99999); // For mobile devices
    navigator.clipboard.writeText(linkInput.value).then(() => {
        const btn = document.getElementById('copy-link-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.backgroundColor = 'var(--success)';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.backgroundColor = '';
        }, 2000);
    });
});

function startScanner() {
    const modal = document.getElementById('scan-modal');
    modal.style.display = 'block';

    html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrCode.start(
        { facingMode: "environment" }, 
        config,
        (decodedText) => {
            // Handle both plain ID and full Smart URL
            let targetId = decodedText;
            try {
                if (decodedText.includes('recipient=')) {
                    const url = new URL(decodedText);
                    targetId = url.searchParams.get('recipient');
                }
            } catch (e) {
                // If not a URL, assume it's a plain ID
            }

            if (targetId && targetId.length === 6) {
                document.getElementById('recipient_id').value = targetId;
                stopScanner();
            } else {
                alert("Invalid QR Code content.");
            }
        },
        (errorMessage) => {
            // Error (silent)
        }
    ).catch((err) => {
        console.error(err);
        alert("Camera access denied or error occurred.");
        closeModal('scan-modal');
    });
}

function stopScanner() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            closeModal('scan-modal');
        }).catch(() => {
            closeModal('scan-modal');
        });
    } else {
        closeModal('scan-modal');
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Close modals when clicking outside
window.onclick = function(event) {
    if (event.target.className === 'modal') {
        if (event.target.id === 'scan-modal') {
            stopScanner();
        } else {
            closeModal(event.target.id);
        }
    }
}
