let html5QrCode;
let currentUser;
let pollInterval;

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    fetchUserData();
    fetchPendingTransfers();
    checkUrlParams();

    // Start auto-refresh polling (every 15 seconds)
    pollInterval = setInterval(() => {
        fetchPendingTransfers();
    }, 15000);

    // Event Listeners
    document.getElementById('logout-btn').addEventListener('click', async () => {
        clearInterval(pollInterval);
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = 'login.html';
    });

    document.getElementById('transfer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const recipient_id = document.getElementById('recipient_id').value;
        const amount = document.getElementById('amount').value;
        const note = document.getElementById('transfer_note').value;

        const res = await fetch('/api/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient_id, amount, note })
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
            fetchAdminUsers(); 
            fetchUserData(); 
        } else {
            alert(data.error);
        }
    });

    document.getElementById('admin-search-input').addEventListener('input', (e) => {
        fetchAdminUsers(e.target.value);
    });
});

function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const recipient = params.get('recipient');
    if (recipient && recipient.length === 6) {
        document.getElementById('recipient_id').value = recipient;
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
    balanceEl.textContent = `£${currentUser.balance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    
    if (currentUser.balance < 0) {
        balanceEl.classList.add('neg-balance');
    } else {
        balanceEl.classList.remove('neg-balance');
    }

    document.getElementById('id-display').textContent = currentUser.id;
    document.getElementById('latest-tx-display').textContent = currentUser.latest_transaction;

    if (currentUser.is_admin) {
        document.getElementById('admin-panel').style.display = 'block';
        fetchAdminUsers();
    }
}

async function fetchAdminUsers(query = '') {
    const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    const users = await res.json();
    const tbody = document.getElementById('admin-user-list');
    tbody.innerHTML = '';

    users.forEach(u => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.innerHTML = `
            <td style="padding: 0.8rem;">${u.id}</td>
            <td style="padding: 0.8rem;">${u.full_name}</td>
            <td style="padding: 0.8rem;">${u.email}</td>
            <td style="padding: 0.8rem; font-weight: bold;" class="${u.balance < 0 ? 'neg-balance' : ''}">
                £${u.balance.toLocaleString(undefined, {minimumFractionDigits: 2})}
            </td>
            <td style="padding: 0.8rem;">
                <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}', '${u.full_name}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteUser(id, name) {
    if (id === currentUser.id) {
        alert("You cannot delete yourself, Larry!");
        return;
    }

    if (confirm(`ARE YOU SURE? This will permanently delete ${name} (ID: ${id}) and all their transfers.`)) {
        const res = await fetch(`/api/admin/user/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            alert(data.message);
            fetchAdminUsers(document.getElementById('admin-search-input').value);
        } else {
            alert(data.error);
        }
    }
}

async function fetchPendingTransfers() {
    const res = await fetch('/api/transfers/pending');
    if (!res.ok) return;
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
        const noteHtml = t.note ? `<br><small style="color: #888;">Note: ${t.note}</small>` : '';
        div.innerHTML = `
            <div>
                <strong>From: ${t.sender_name}</strong>${noteHtml}<br>
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
        fetchUserData(); 
        fetchPendingTransfers(); 
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
    qrContainer.innerHTML = ''; 
    
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
    linkInput.setSelectionRange(0, 99999); 
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
            let targetId = decodedText;
            try {
                if (decodedText.includes('recipient=')) {
                    const url = new URL(decodedText);
                    targetId = url.searchParams.get('recipient');
                }
            } catch (e) {}

            if (targetId && targetId.length === 6) {
                document.getElementById('recipient_id').value = targetId;
                stopScanner();
            } else {
                alert("Invalid QR Code content.");
            }
        },
        (errorMessage) => {}
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

window.onclick = function(event) {
    if (event.target.className === 'modal') {
        if (event.target.id === 'scan-modal') {
            stopScanner();
        } else {
            closeModal(event.target.id);
        }
    }
}
