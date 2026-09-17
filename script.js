 const GAS_URL = "https://script.google.com/macros/s/AKfycbyNnLofyb4NVWXdnnMDxQEUDv6Ui2h4qOPJScc3SFQuRBDST3I63iFakJ7ds8PnKzKLEA/exec";

      let activeTxId = ""; 
      let activeExpirations = {}; 
      let mainTicker = null;
      let resendInterval = null;
      let globalBiayaAdminUSD = 0;
      let globalBiayaAdminIDR = 0;
      let currentForgotEmail = '';
      
      // --- TAMBAHAN REALTIME STATE ---
      let knownActiveTxs = {}; // Menyimpan status transaksi aktif
      let activeTxPolling = null; // Interval polling realtime
      
      // Variable untuk fitur resend OTP registrasi
      let currentRegUser = '';
      let currentRegEmail = '';
      let regResendInterval = null;

      // Variable Grafik Laporan
      let laporanChartInstance = null;

// Fungsi mengambil data biaya admin dari server
async function fetchBiayaAdmin() {
    try {
        const formData = new URLSearchParams();
        formData.append('action', 'get_biaya_admin');
        
        const response = await fetch(GAS_URL, { method: 'POST', body: formData });
        const result = await response.json();
        
        if (result.status === 'success') {
            globalBiayaAdminUSD = result.biayaUSD;
            globalBiayaAdminIDR = result.biayaIDR;
        }
    } catch (e) {
        console.log("Gagal memuat data Biaya Admin", e);
    }
}

// Jalankan pengambilan biaya admin saat aplikasi pertama kali dimuat
fetchBiayaAdmin();

// Fungsi untuk menentukan nominal layanan berdasarkan mata uang
function getBiayaLayananDynamic(mataUang) {
    if (mataUang === 'USD') {
        return globalBiayaAdminUSD;
    } else if (mataUang === 'IDR') {
        return globalBiayaAdminIDR;
    }
    return 0; // Default jika error
}
// --- AKHIR SCRIPT BIAYA ADMIN ---

// --- STATE TAMBAHAN UNTUK ANTI-FLICKER ---
window.lastTxDataHash = "";
window.lastPendingHash = "";

// --- FUNGSI POLLING REALTIME UNTUK CEK STATUS ADMIN ---
function startRealtimePolling() {
    if (activeTxPolling) clearInterval(activeTxPolling);
    // Polling setiap 5 detik dengan metode Silent Update di background
    activeTxPolling = setInterval(pollForAdminUpdates, 5000);
}

async function pollForAdminUpdates() {
    const username = localStorage.getItem('userUsername');
    if (!username) return;
    
    const formData = new URLSearchParams();
    formData.append('action', 'get_transaksi');
    formData.append('username', username);
    
    try {
        const response = await fetch(GAS_URL, { method: 'POST', body: formData });
        const result = await response.json();
        
        if (result.status === 'success' && result.data) {
            let newDataHash = JSON.stringify(result.data);
            
            result.data.forEach(tx => {
                const txId = tx.idPesanan;
                const newStatus = (tx.status || '').trim().toLowerCase();
                
                if (knownActiveTxs[txId] && (knownActiveTxs[txId] === 'pending' || knownActiveTxs[txId] === 'proses') &&
                    (newStatus === 'selesai' || newStatus === 'berhasil' || newStatus === 'success')) {
                    
                    if (typeof showToast === 'function') {
                        showToast(`${tx.kategori} mata uang ${tx.mataUang}/IDR anda telah dikonfirmasi oleh admin`, 'success');
                    }
                }
                
                if (newStatus === 'pending' || newStatus === 'proses') {
                    knownActiveTxs[txId] = newStatus;
                } else {
                    delete knownActiveTxs[txId];
                }
            });
            
            // Anti-Flicker: Update DOM HTML HANYA jika terjadi perubahan data pada server
            if (window.lastTxDataHash !== newDataHash) {
                window.lastTxDataHash = newDataHash;
                
                // Render list transaksi secara silent
                if (result.data.length > 0) {
                    if (typeof renderTransactionLists === 'function') {
                        renderTransactionLists(result.data);
                    }
                } else {
                    renderEmptyTransactions();
                }
                
                // Update Badge & List secara silent
                updatePendingStateSilently(result.data);
            }
        }
    } catch (e) {
        console.log("Menunggu koneksi stabil untuk silent update...", e);
    }
}

function renderEmptyTransactions() {
    const containerRiwayat = document.getElementById('tx-list-container');
    const containerAktif = document.getElementById('tx-aktif-list-container');
    if (containerRiwayat) containerRiwayat.innerHTML = '<div style="text-align:center; padding: 3rem 1rem; color: #94a3b8;"><i class="fa-solid fa-folder-open" style="font-size: 2.5rem; margin-bottom: 0.75rem; color:#cbd5e1;"></i><p style="margin:0; font-weight:600;">Belum Ada Riwayat Selesai</p></div>';
    if (containerAktif) containerAktif.innerHTML = '<div style="text-align:center; padding: 3rem 1rem; color: #94a3b8;"><i class="fa-solid fa-clipboard-check" style="font-size: 2.5rem; margin-bottom: 0.75rem; color:#cbd5e1;"></i><p style="margin:0; font-weight:600;">Tidak Ada Transaksi Aktif</p><p style="font-size:0.8rem; margin-top:4px;">Semua pesanan sudah selesai.</p></div>';
}

function updatePendingStateSilently(allData) {
    const pendings = allData.filter(tx => tx.status.toLowerCase() === 'pending' && tx.remainingSec > 0);
    
    const badge = document.getElementById('notif-badge-count');
    if (badge) {
        if (pendings.length > 0) {
            badge.innerText = pendings.length;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
    
    pendings.forEach(tx => {
        if (!activeExpirations[tx.idPesanan] || Math.abs(activeExpirations[tx.idPesanan] - tx.remainingSec) > 10) {
            activeExpirations[tx.idPesanan] = tx.remainingSec;
        }
    });
    
    const pendingIds = pendings.map(t => t.idPesanan);
    Object.keys(activeExpirations).forEach(id => {
        if (!pendingIds.includes(id)) {
            delete activeExpirations[id];
        }
    });
    
    const newPendingHash = JSON.stringify(pendings);
    if (document.getElementById('page-pending-list') && document.getElementById('page-pending-list').classList.contains('open')) {
        if (window.lastPendingHash !== newPendingHash) {
            window.lastPendingHash = newPendingHash;
            if (typeof renderPendingList === 'function') {
                renderPendingList(pendings);
            }
        }
    } else {
        window.lastPendingHash = newPendingHash;
    }
}
// -----------------------------------------------------

     function startGlobalTicker() {
    if (mainTicker) clearInterval(mainTicker);
    mainTicker = setInterval(() => {
        let needsRefresh = false;
        for (let id in activeExpirations) {
            if (activeExpirations[id] > 0) {
                activeExpirations[id]--;
                
                if (id === activeTxId && document.getElementById('page-detail-pembayaran').classList.contains('open')) {
                    let mins = Math.floor(activeExpirations[id] / 60);
                    let secs = activeExpirations[id] % 60;
                    document.getElementById('countdown-timer').innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                }
                
                if (document.getElementById('page-pending-list').classList.contains('open')) {
                    const timerEl = document.getElementById(`notif-timer-${id}`);
                    if (timerEl) {
                        let mins = Math.floor(activeExpirations[id] / 60);
                        let secs = activeExpirations[id] % 60;
                        timerEl.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                    }
                }
                
                const timerAktifEl = document.getElementById(`aktif-timer-${id}`);
                if (timerAktifEl) {
                    let mins = Math.floor(activeExpirations[id] / 60);
                    let secs = activeExpirations[id] % 60;
                    timerAktifEl.innerHTML = `<i class="fa-regular fa-clock fa-spin" style="animation-duration: 3s;"></i> ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                }
                
                if (activeExpirations[id] <= 0) {
                    showToast(`Waktu pembayaran pesanan #${id} telah habis.`);
                    delete activeExpirations[id];
                    needsRefresh = true;
                    
                    if (id === activeTxId) {
                        activeTxId = "";
                        if (document.getElementById('page-detail-pembayaran').classList.contains('open')) {
                            document.getElementById('countdown-timer').innerText = "Kadaluarsa";
                            setTimeout(() => closeAllToHome(), 1500);
                        }
                    }
                }
            }
        }
        
        if (needsRefresh) {
            fetchPendingData();
            if ((document.getElementById('main-transaksi-page') && document.getElementById('main-transaksi-page').style.display !== 'none') ||
                (document.getElementById('main-transaksi-aktif-page') && document.getElementById('main-transaksi-aktif-page').style.display !== 'none')) {
                loadTransactions();
            }
        }
    }, 1000);
}

function resetCheckoutState() {
    activeTxId = "";
}

async function fetchPendingData() {
    const username = localStorage.getItem('userUsername');
    if (!username) return;
    
    const formData = new URLSearchParams();
    formData.append('action', 'get_transaksi');
    formData.append('username', username);
    
    try {
        const response = await fetch(GAS_URL, { method: 'POST', body: formData });
        const result = await response.json();
        
        if (result.status === 'success' && result.data) {
            updatePendingStateSilently(result.data);
        }
    } catch (e) { console.error("Gagal memuat pending data realtime", e); }
}

      function checkAuth() {
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    if (isLoggedIn === 'true') {
        const userName = localStorage.getItem('userName') || 'Pengguna';
        const userEmail = localStorage.getItem('userEmail') || 'email@terverifikasi.com';
        document.getElementById('display-user-name').innerText = userName;
        if (document.getElementById('profile-display-name')) { document.getElementById('profile-display-name').innerText = userName; }
        if (document.getElementById('profile-display-email')) { document.getElementById('profile-display-email').innerText = userEmail; }
        const authView = document.getElementById('auth-view');
        authView.classList.add('hidden');
        authView.style.display = 'none';
        loadCurrencyData();
        fetchPendingData();
        startRealtimePolling();
    }
}

function switchTab(tab) {
          const homePage = document.getElementById('main-home-page');
          const transaksiAktifPage = document.getElementById('main-transaksi-aktif-page');
          const riwayatPage = document.getElementById('main-transaksi-page');
          const profilePage = document.getElementById('main-profile-page');
          const navBtns = document.querySelectorAll('.bottom-nav .nav-btn');
          
          navBtns.forEach(btn => { btn.classList.remove('active'); btn.classList.add('inactive'); });
          
          homePage.style.display = 'none';
          if(transaksiAktifPage) transaksiAktifPage.style.display = 'none';
          if(riwayatPage) riwayatPage.style.display = 'none';
          profilePage.style.display = 'none';

          if(tab === 'home') {
              homePage.style.display = 'block';
              navBtns[0].classList.add('active'); navBtns[0].classList.remove('inactive');
          } else if(tab === 'transaksi_aktif') {
              if(transaksiAktifPage) transaksiAktifPage.style.display = 'block';
              navBtns[1].classList.add('active'); navBtns[1].classList.remove('inactive');
              loadTransactions(); 
          } else if(tab === 'riwayat') {
              if(riwayatPage) riwayatPage.style.display = 'block';
              navBtns[2].classList.add('active'); navBtns[2].classList.remove('inactive');
              loadTransactions(); 
          } else if(tab === 'profile') {
              profilePage.style.display = 'block';
              navBtns[3].classList.add('active'); navBtns[3].classList.remove('inactive');
          }
      }

      async function loadTransactions() {
          const username = localStorage.getItem('userUsername') || '';
          const containerRiwayat = document.getElementById('tx-list-container');
          const containerAktif = document.getElementById('tx-aktif-list-container');
          
          if (!username) {
              const loginMsg = '<div style="text-align:center; padding: 2.5rem 1rem; color: #94a3b8;"><i class="fa-solid fa-lock" style="font-size: 2rem; margin-bottom: 0.5rem;"></i><p>Silakan login terlebih dahulu untuk melihat data transaksi.</p></div>';
              if(containerRiwayat) containerRiwayat.innerHTML = loginMsg;
              if(containerAktif) containerAktif.innerHTML = loginMsg;
              return;
          }

          // ANTI-FLICKER: Bypass animasi loading spinner jika kontainer sudah memiliki render sebelumnya
          const isRiwayatEmpty = !containerRiwayat || containerRiwayat.innerHTML.trim() === '' || containerRiwayat.innerHTML.includes('fa-lock');
          
          if (isRiwayatEmpty) {
              const loadingMsg = '<div style="text-align:center; padding: 2.5rem 1rem; color: #64748b;"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p style="margin-top:0.75rem; font-size:0.9rem;">Memuat data transaksi realtime...</p></div>';
              if(containerRiwayat) containerRiwayat.innerHTML = loadingMsg;
              if(containerAktif) containerAktif.innerHTML = loadingMsg;
          }

          try {
              const formData = new URLSearchParams();
              formData.append('action', 'get_transaksi');
              formData.append('username', username);

              const response = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await response.json();

              if (result.status === 'success' && result.data) {
                  const newDataHash = JSON.stringify(result.data);
                  
                  // Merender ulang layar HANYA jika ada data terbaru, mencegah layar berkedip akibat reload paksa
                  if (window.lastTxDataHash !== newDataHash || isRiwayatEmpty) {
                      window.lastTxDataHash = newDataHash;
                      if (result.data.length > 0) {
                          if(typeof renderTransactionLists === 'function') renderTransactionLists(result.data);
                      } else {
                          renderEmptyTransactions();
                      }
                  }
              }
          } catch (error) {
              console.error('Error fetching transactions:', error);
              if (isRiwayatEmpty) {
                  const errMsg = '<div style="text-align:center; padding: 2.5rem 1rem; color: #ef4444;"><i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 0.5rem;"></i><p>Gagal memuat data transaksi. Periksa koneksi internet Anda.</p></div>';
                  if(containerRiwayat) containerRiwayat.innerHTML = errMsg;
                  if(containerAktif) containerAktif.innerHTML = errMsg;
              }
          }
      }
      
      function formatTxDate(dateStr) {
          if (!dateStr) return '-';
          let dateObj = new Date(dateStr);
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

          if (isNaN(dateObj.getTime())) {
              const str = String(dateStr).trim();
              const parts = str.split(' ');
              if (parts.length >= 2) {
                  const dateParts = parts[0].split('/');
                  const timeParts = parts[1].split(':');
                  if (dateParts.length === 3 && timeParts.length >= 2) {
                      const day = parseInt(dateParts[0], 10);
                      const monthIdx = parseInt(dateParts[1], 10) - 1;
                      let year = dateParts[2];
                      if (year.length === 2) year = '20' + year;
                      
                      const monthName = months[monthIdx] || dateParts[1];
                      const hh = String(timeParts[0]).padStart(2, '0');
                      const mm = String(timeParts[1]).padStart(2, '0');
                      return `${day} ${monthName} ${year}. ${hh}:${mm}`;
                  }
              }
              return str;
          }
          
          const day = dateObj.getDate();
          const monthIdx = dateObj.getMonth();
          const year = dateObj.getFullYear();
          const monthName = months[monthIdx];
          const hh = String(dateObj.getHours()).padStart(2, '0');
          const mm = String(dateObj.getMinutes()).padStart(2, '0');
          
          return `${day} ${monthName} ${year}. ${hh}:${mm}`;
      }

     function renderTransactionLists(transactions) {
    const containerRiwayat = document.getElementById('tx-list-container');
    const containerAktif = document.getElementById('tx-aktif-list-container');
    
    if (containerRiwayat) containerRiwayat.innerHTML = '';
    if (containerAktif) containerAktif.innerHTML = '';
    
    let countRiwayat = 0;
    let countAktif = 0;
    
    transactions.slice().reverse().forEach(tx => {
        const statusStr = (tx.status || 'Pending').trim().toLowerCase();
        const isSelesai = (statusStr === 'berhasil' || statusStr === 'selesai' || statusStr === 'success');
        const isAktif = (statusStr === 'pending' || statusStr === 'proses');
        
        // Daftarkan ke state lokal untuk dipantau realtime
        if (isAktif) {
            knownActiveTxs[tx.idPesanan] = statusStr;
        }
        
        if (isSelesai) {
            renderSingleTxRiwayat(tx, containerRiwayat);
            countRiwayat++;
        } else if (isAktif) {
            renderSingleTxAktif(tx, containerAktif);
            countAktif++;
        }
    });
    
    if (countRiwayat === 0 && containerRiwayat) {
        containerRiwayat.innerHTML = '<div style="text-align:center; padding: 3rem 1rem; color: #94a3b8;"><p style="margin:0; font-weight:600;">Belum Ada Riwayat Selesai</p></div>';
    }
    if (countAktif === 0 && containerAktif) {
        containerAktif.innerHTML = '<div style="text-align:center; padding: 3rem 1rem; color: #94a3b8;"><i class="fa-solid fa-clipboard-check" style="font-size: 2.5rem; margin-bottom: 0.75rem; color:#cbd5e1;"></i><p style="margin:0; font-weight:600;">Tidak Ada Transaksi Aktif</p><p style="font-size:0.8rem; margin-top:4px;">Semua pesanan sudah selesai.</p></div>';
    }
    
    const activeFilterBtn = document.querySelector('.tx-filter-btn.active');
    if (activeFilterBtn) {
        const activeCat = activeFilterBtn.getAttribute('onclick').match(/'([^']+)'/)[1];
        filterTransaksi(activeCat, activeFilterBtn);
    }
}
      function renderSingleTxRiwayat(tx, container) {
          const kat = (tx.kategori || 'Beli').trim();
          const katLower = kat.toLowerCase();
          const mataUang = tx.mataUang || '';
          const isBeli = katLower === 'beli';

          let iconClass = isBeli ? 'fa-wallet' : 'fa-money-bill-transfer';
          let bgClass = isBeli ? 'bg-green-tx' : 'bg-blue-tx';
          if (isBeli && mataUang === 'SGD') bgClass = 'bg-orange-tx';

          let statusStr = (tx.status || 'Selesai').trim();
          let badgeClass = 'status-success';
          const dateFormatted = formatTxDate(tx.timestamp);

          let rawJumlahBayar = String(tx.jumlahBayar || '0').trim();
          let formatNominal = rawJumlahBayar;

          if (rawJumlahBayar.includes('$') || rawJumlahBayar.toLowerCase().includes('usd')) {
              let numericVal = parseFloat(rawJumlahBayar.replace(/[^0-9.]/g, '')) || 0;
              formatNominal = '$ ' + numericVal.toLocaleString('en-US');
          } else {
              let numericVal = parseFloat(rawJumlahBayar.replace(/[^0-9]/g, '')) || 0;
              formatNominal = 'Rp. ' + numericVal.toLocaleString('id-ID');
          }

          let estimasiVal = tx.estimasi || '-';
          if (katLower === 'beli' && (mataUang.toUpperCase() === 'IDR' || estimasiVal.toLowerCase().includes('rp'))) {
              let numericVal = parseFloat(estimasiVal.toString().replace(/[^0-9]/g, '')) || 0;
              estimasiVal = 'Rp. ' + numericVal.toLocaleString('id-ID');
          }

          const card = document.createElement('div');
          card.className = 'tx-card-item';
          card.setAttribute('data-category', katLower);
          card.innerHTML = `
              <div class="tx-card-left">
                  <div class="tx-icon-circle ${bgClass}">
                      <i class="fa-solid ${iconClass}"></i>
                  </div>
                  <div class="tx-card-info">
                      <h4 class="tx-card-title">${kat} ${mataUang}</h4>
                      <p class="tx-card-date">${dateFormatted}</p>
                  </div>
              </div>
              <div class="tx-card-right">
                  <span class="tx-amount-main">${formatNominal}</span>
                  <span class="tx-amount-sub">${estimasiVal} <i class="fa-solid fa-chevron-right tx-chevron"></i></span>
                  <span class="tx-status-badge ${badgeClass}">${statusStr}</span>
              </div>
          `;
          if(container) container.appendChild(card);
      }

      function renderSingleTxAktif(tx, container) {
          let statusStr = (tx.status || 'Pending').trim();
          let statusLower = statusStr.toLowerCase();
          
          let rawJumlahBayar = String(tx.jumlahBayar || '0').trim();
          let formatNominal = rawJumlahBayar;
          if (rawJumlahBayar.includes('$') || rawJumlahBayar.toLowerCase().includes('usd')) {
              let numericVal = parseFloat(rawJumlahBayar.replace(/[^0-9.]/g, '')) || 0;
              formatNominal = '$ ' + numericVal.toLocaleString('en-US');
          } else {
              let numericVal = parseFloat(rawJumlahBayar.replace(/[^0-9]/g, '')) || 0;
              formatNominal = 'Rp ' + numericVal.toLocaleString('id-ID');
          }

          let estimasiVal = tx.estimasi || '-';
          if (tx.kategori?.toLowerCase() === 'beli' && (tx.mataUang?.toUpperCase() === 'IDR' || estimasiVal.toLowerCase().includes('rp'))) {
              let numericVal = parseFloat(estimasiVal.toString().replace(/[^0-9]/g, '')) || 0;
              estimasiVal = 'Rp ' + numericVal.toLocaleString('id-ID');
          }

          let isPending = statusLower === 'pending';
          let timerHtml = '';
          
          if (isPending) {
              let remSec = activeExpirations[tx.idPesanan] || tx.remainingSec || 0;
              let timerText = "00:00";
              if (remSec > 0) {
                  let mins = Math.floor(remSec / 60);
                  let secs = remSec % 60;
                  timerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
              } else {
                  timerText = "Expired";
              }
              timerHtml = `<span class="timer-aktif" id="aktif-timer-${tx.idPesanan}"><i class="fa-regular fa-clock fa-spin" style="animation-duration: 3s;"></i> ${timerText}</span>`;
          } else {
              timerHtml = `<span style="font-size: 0.8rem; color: #10b981; font-weight: 600;"><i class="fa-solid fa-spinner fa-spin"></i> Sedang Diproses</span>`;
          }

          let badgeClass = isPending ? 'status-pending' : 'status-proses';
          let cardExtClass = isPending ? '' : 'proses-card';

          const card = document.createElement('div');
          card.className = `tx-aktif-card fade-in-up ${cardExtClass}`;
          
          if (isPending) {
              card.onclick = () => openPendingCheckoutFromData(tx);
          } else {
              card.onclick = () => showToast("Pesanan anda sedang dalam proses peninjauan Admin.", "info");
          }

          card.innerHTML = `
              <div class="tx-aktif-header">
                  <span class="tx-aktif-id">Trx ID: ${tx.idPesanan}</span>
                  <span class="tx-status-badge ${badgeClass}">${statusStr}</span>
              </div>
              <div class="tx-aktif-body">
                  <div class="tx-aktif-left" style="display:flex; align-items:center;">
                      <div style="width:42px; height:42px; border-radius:50%; background:rgba(37,99,235,0.08); display:flex; justify-content:center; align-items:center; color:#2563eb;">
                          <i class="fa-solid ${tx.kategori?.toLowerCase() === 'beli' ? 'fa-wallet' : 'fa-money-bill-transfer'}" style="font-size: 1.1rem;"></i>
                      </div>
                      <div style="margin-left: 14px;">
                          <h4 style="margin:0; font-size: 1.05rem; color:#1e293b;">${tx.kategori} ${tx.mataUang}</h4>
                          <p style="margin:0; font-size: 0.8rem; color:#64748b; margin-top:2px;">${formatNominal}</p>
                      </div>
                  </div>
                  <div class="tx-aktif-right" style="text-align:right;">
                      <p style="margin:0; font-size: 0.75rem; color:#64748b; margin-bottom:2px;">Estimasi</p>
                      <h5 style="margin:0; font-size: 0.95rem; color:#10b981;">${estimasiVal}</h5>
                  </div>
              </div>
              <div class="tx-aktif-footer">
                  ${timerHtml}
                  <span style="font-size: 0.8rem; color:#2563eb; font-weight:700;">Lihat Detail <i class="fa-solid fa-chevron-right" style="margin-left:2px; font-size:0.75rem;"></i></span>
              </div>
          `;
          if(container) container.appendChild(card);
      }

      function filterTransaksi(category, element) {
          const buttons = document.querySelectorAll('.tx-filter-btn');
          buttons.forEach(btn => btn.classList.remove('active'));
          element.classList.add('active');

          const items = document.querySelectorAll('#tx-list-container .tx-card-item');
          items.forEach(item => {
              if (category === 'semua') {
                  item.style.display = 'flex';
              } else {
                  if (item.getAttribute('data-category') === category) {
                      item.style.display = 'flex';
                  } else {
                      item.style.display = 'none';
                  }
              }
          });
      }
      
      function openPendingList() {
          document.getElementById('page-pending-list').classList.add('open');
          fetchPendingData();
      }

      function closePendingList() {
          document.getElementById('page-pending-list').classList.remove('open');
      }

      /* FITUR HALAMAN INFORMASI & ARTIKEL */
      function openInformasi() {
          document.getElementById('page-informasi').classList.add('open');
      }

      function closeInformasi() {
          document.getElementById('page-informasi').classList.remove('open');
      }

      function filterArticles(category, element) {
          const pills = document.querySelectorAll('.info-filter-pill');
          pills.forEach(p => p.classList.remove('active'));
          element.classList.add('active');

          const cards = document.querySelectorAll('#info-articles-container .info-card');
          cards.forEach(card => {
              if (category === 'semua') {
                  card.style.display = 'flex';
              } else {
                  if (card.getAttribute('data-cat') === category) {
                      card.style.display = 'flex';
                  } else {
                      card.style.display = 'none';
                  }
              }
          });
      }

      /* FITUR HALAMAN LAPORAN (BARU) */
      async function openLaporan() {
          const username = localStorage.getItem('userUsername');
          if(!username) {
              showToast('Silakan login terlebih dahulu!');
              return;
          }
          
          document.getElementById('page-laporan').classList.add('open');
          document.getElementById('laporan-total-beli').classList.add('skeleton-text');
          document.getElementById('laporan-total-jual').classList.add('skeleton-text');
          await renderLaporanData(username);
      }

      function closeLaporan() {
          document.getElementById('page-laporan').classList.remove('open');
          if(laporanChartInstance) {
              laporanChartInstance.destroy();
              laporanChartInstance = null;
          }
      }

      async function renderLaporanData(username) {
          try {
              const formData = new URLSearchParams();
              formData.append('action', 'get_transaksi');
              formData.append('username', username);
              
              const response = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await response.json();
              
              if (result.status === 'success' && result.data) {
                  processLaporanChartData(result.data);
              } else {
                  processLaporanChartData([]);
              }
          } catch(e) {
              console.error("Gagal memuat laporan", e);
              showToast("Gagal memuat data laporan.");
              processLaporanChartData([]);
          }
      }

      function processLaporanChartData(transactions) {
          let totalBeli = 0;
          let totalJual = 0;

          // HANYA menghitung data dengan status Selesai
          const txSelesai = transactions.filter(tx => (tx.status || '').toLowerCase() === 'selesai');
          let txCount = txSelesai.length;

          let chartLabels = [];
          let chartBeli = [];
          let chartJual = [];
          
          const today = new Date();
          let dateMap = {};
          let orderedKeys = [];
          const namaHari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
          
          // Mempersiapkan array untuk 7 hari terakhir (Nama Hari untuk X-axis)
          for(let i=6; i>=0; i--) {
              let d = new Date(today);
              d.setDate(today.getDate() - i);
              
              let key = `${d.getDate()}/${d.getMonth()+1}`;
              let dayName = namaHari[d.getDay()];
              
              chartLabels.push(dayName);
              orderedKeys.push(key);
              dateMap[key] = { beli: 0, jual: 0 };
          }

          txSelesai.forEach(tx => {
              const kat = (tx.kategori || '').toLowerCase();
              
              let amountIdr = 0;
              let rawBayar = String(tx.jumlahBayar || '0');
              let rawEstimasi = String(tx.estimasi || '0');

              if (kat === 'beli') {
                  // Jika pengguna Membeli Valas, maka total transaksi dlm Rupiah ada di jumlahBayar
                  amountIdr = parseFloat(rawBayar.replace(/[^0-9]/g, '')) || 0;
                  totalBeli += amountIdr;
              } else if (kat === 'jual') {
                  // Jika pengguna Menjual Valas, total yg didapat dlm Rupiah ada di estimasi
                  amountIdr = parseFloat(rawEstimasi.replace(/[^0-9]/g, '')) || 0;
                  totalJual += amountIdr;
              }

              // Pemetaan ke grafik 7 Hari (berdasarkan Timestamp transaksi)
              if (tx.timestamp) {
                  let d = new Date(tx.timestamp);
                  let keyMatch = "";
                  if(isNaN(d.getTime())) {
                      let parts = String(tx.timestamp).split(' ')[0].split('/');
                      if(parts.length >= 2) {
                          let day = parseInt(parts[0], 10);
                          let month = parseInt(parts[1], 10);
                          keyMatch = `${day}/${month}`;
                      }
                  } else {
                      keyMatch = `${d.getDate()}/${d.getMonth()+1}`;
                  }

                  if(keyMatch && dateMap[keyMatch] !== undefined) {
                      if(kat === 'beli') dateMap[keyMatch].beli += amountIdr;
                      if(kat === 'jual') dateMap[keyMatch].jual += amountIdr;
                  }
              }
          });

          // Memperbarui UI Laporan
          const elBeli = document.getElementById('laporan-total-beli');
          const elJual = document.getElementById('laporan-total-jual');
          elBeli.classList.remove('skeleton-text');
          elJual.classList.remove('skeleton-text');
          elBeli.innerText = 'Rp ' + totalBeli.toLocaleString('id-ID');
          elJual.innerText = 'Rp ' + totalJual.toLocaleString('id-ID');
          
          document.getElementById('insight-count').innerText = txCount + ' Transaksi';
          document.getElementById('insight-status').innerText = txCount > 0 ? 'SELESAI' : '-';

          orderedKeys.forEach(key => {
              chartBeli.push(dateMap[key].beli);
              chartJual.push(dateMap[key].jual);
          });

          renderChartLaporan(chartLabels, chartBeli, chartJual);
      }

      function renderChartLaporan(labels, dataBeli, dataJual) {
          const ctx = document.getElementById('laporanChart').getContext('2d');
          if(laporanChartInstance) {
              laporanChartInstance.destroy();
          }
          
          laporanChartInstance = new Chart(ctx, {
              type: 'bar',
              data: {
                  labels: labels,
                  datasets: [
                      {
                          label: 'Beli (Rp)',
                          data: dataBeli,
                          backgroundColor: 'rgba(16, 185, 129, 0.9)', // Green Color
                          borderRadius: 6,
                          barThickness: 12
                      },
                      {
                          label: 'Jual (Rp)',
                          data: dataJual,
                          backgroundColor: 'rgba(59, 130, 246, 0.9)', // Blue Color
                          borderRadius: 6,
                          barThickness: 12
                      }
                  ]
              },
              options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: {
                      mode: 'index',
                      intersect: false,
                  },
                  scales: {
                      y: { 
                          beginAtZero: true, 
                          ticks: {
                              callback: function(value) {
                                  if(value >= 1000000) return (value / 1000000) + 'M';
                                  if(value >= 1000) return (value / 1000) + 'K';
                                  return value;
                              },
                              font: { size: 10, family: "'Poppins', sans-serif" }
                          },
                          grid: { borderDash: [2, 4], color: '#f1f5f9' }
                      },
                      x: {
                          grid: { display: false },
                          ticks: { font: { size: 10, family: "'Poppins', sans-serif" } }
                      }
                  },
                  plugins: {
                      legend: { position: 'top', labels: { boxWidth: 10, usePointStyle: true, font: { size: 11, family: "'Poppins', sans-serif" } } }
                  }
              }
          });
      }

      const articlesData = {
          1: {
              tag: "Berita Kurs",
              tagClass: "tag-blue",
              title: "Analisis Pergerakan Kurs USD/IDR: Memahami Dinamika Pasar Valuta Asing",
              author: "Tim Analis MoneyChanger",
              date: "Update Realtime",
              content: `
                  <p>Pergerakan nilai tukar Dollar Amerika Serikat (USD) terhadap Rupiah Indonesia (IDR) senantiasa berfluktuasi dipengaruhi oleh kondisi makroekonomi global dan domestik.</p>
                  <div class="article-highlight-box">
                      <strong>Faktor Utama Pembuat Pergerakan Kurs:</strong><br>
                      • Kebijakan Suku Bunga Bank Sentral (The Fed & BI)<br>
                      • Tingkat Inflasi Global & Neraca Perdagangan<br>
                      • Sentimen Pasar Finansial Dunia
                  </div>
                  <p>Bagi pelaku usaha penukaran mata uang dan nasabah, memantau pergerakan rate secara realtime sangat penting sebelum melakukan transaksi jual maupun beli valas. Di MoneyChanger, kami menyediakan tarif kurs transparan dengan mid-market rate paling presisi.</p>
              `
          },
          2: {
              tag: "Panduan Beli",
              tagClass: "tag-green",
              title: "Panduan Lengkap Membeli Valas (USD) dengan Rate Realtime Terbaik",
              author: "Edukasi Transaksi",
              date: "Panduan Resmi",
              content: `
                  <p>Membeli mata uang asing (Valas) melalui aplikasi MoneyChanger dirancang sangat cepat, transparan, dan mudah. Berikut langkah-langkah simpelnya:</p>
                  <p><strong>1. Pilih Menu 'Beli Valas':</strong> Masukkan nominal Rupiah yang ingin Anda tukarkan atau tentukan jumlah USD yang ingin dibeli.</p>
                  <p><strong>2. Cek Estimasi Diterima:</strong> Sistem secara otomatis menghitung nilai estimasi yang akan Anda terima berdasarkan rate realtime yang berlaku.</p>
                  <p><strong>3. Lanjutkan Checkout & Pembayaran:</strong> Lakukan transfer ke rekening resmi yang tertera (BCA / ABA PAY) sebelum waktu hitung mundur pesanan berakhir.</p>
                  <div class="article-highlight-box">
                      <strong>Tips Keamanan:</strong> Pastikan Anda mengunggah bukti struk transfer pembayaran agar pesanan diproses instan oleh tim kami.
                  </div>
              `
          },
          3: {
              tag: "Panduan Jual",
              tagClass: "tag-purple",
              title: "Tata Cara Penjualan Valas via ABA PAY & Rekening Bank Resmi",
              author: "Tim Layanan Finansial",
              date: "Panduan Resmi",
              content: `
                  <p>Jika Anda memiliki simpanan USD dan ingin mencairkannya ke dalam mata uang Rupiah, fitur Jual Valas di MoneyChanger adalah solusi paling praktis.</p>
                  <p><strong>Langkah Transaksi Jual Valas:</strong></p>
                  <p>1. Klik tombol <strong>Jual Valas</strong> pada halaman utama aplikasi.</p>
                  <p>2. Masukkan jumlah USD yang ingin Anda jual (Minimal $ 50 USD).</p>
                  <p>3. Pilih metode penerimaan dana, yaitu ke Rekening Bank Rupiah (BCA) atau via ABA PAY Co LTD.</p>
                  <div class="article-highlight-box">
                      <strong>Proses Verifikasi Cepat:</strong> Setelah bukti dikonfirmasi, dana Rupiah Anda akan langsung dikirimkan ke rekening tujuan dengan jaminan transparansi 100%.
                  </div>
              `
          },
          4: {
              tag: "Tips Finansial",
              tagClass: "tag-orange",
              title: "Mengenal Spread Beli & Jual: Kunci Mendapatkan Keuntungan Optimal",
              author: "Pakar Penukaran Valas",
              date: "Tips Finansial",
              content: `
                  <p>Dalam dunia money changer dan perbankan, istilah <em>Spread</em> mengacu pada selisih antara harga Beli (Buy Rate) dan harga Jual (Sell Rate) suatu mata uang.</p>
                  <p><strong>Memahami Istilah:</strong></p>
                  <p>• <strong>Harga Beli (Buy Rate):</strong> Harga yang digunakan saat Anda menjual valas kepada Money Changer (Money Changer membeli dari Anda).</p>
                  <p>• <strong>Harga Jual (Sell Rate):</strong> Harga yang digunakan saat Anda membeli valas dari Money Changer (Money Changer menjual kepada Anda).</p>
                  <div class="article-highlight-box">
                      <strong>Keunggulan MoneyChanger:</strong> Kami menawarkan margin spread yang sangat tipis dan kompetitif sehingga Anda selalu mendapatkan nilai tukar paling maksimal.
                  </div>
              `
          }
      };

      function openArticleModal(id) {
          const article = articlesData[id];
          if(!article) return;

          const modalBody = document.getElementById('article-modal-body');
          modalBody.innerHTML = `
              <span class="info-tag ${article.tagClass} article-detail-tag">${article.tag}</span>
              <h2 class="article-detail-title">${article.title}</h2>
              <div class="article-detail-meta">
                  <span><i class="fa-regular fa-user"></i> ${article.author}</span>
                  <span><i class="fa-regular fa-clock"></i> ${article.date}</span>
              </div>
              <div class="article-detail-content">
                  ${article.content}
              </div>
          `;
          document.getElementById('article-detail-modal').classList.add('show');
      }

      function closeArticleModal() {
          document.getElementById('article-detail-modal').classList.remove('show');
      }

      function renderPendingList(pendings) {
          const container = document.getElementById('pending-list-container');
          container.innerHTML = '';
          
          if (!pendings || pendings.length === 0) {
              container.innerHTML = '<div style="text-align:center; padding: 3rem 1rem; color: #94a3b8;"><p>Tidak ada pesan notifikasi pending saat ini.</p></div>';
              return;
          }

          // Urutkan agar pesanan/notifikasi terbaru berada paling atas
          const sortedPendings = pendings.slice().reverse();

          sortedPendings.forEach(tx => {
              const mataUang = tx.mataUang || 'USD';
              const remSec = activeExpirations[tx.idPesanan] || tx.remainingSec || 0;
              const kat = (tx.kategori || '').toLowerCase();
              const jenisTransaksi = (kat === 'jual' || kat === 'penjualan') ? 'penjualan' : 'pembelian';
              
              let timerText = "00:00";
              if (remSec > 0) {
                  let mins = Math.floor(remSec / 60);
                  let secs = remSec % 60;
                  timerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
              } else {
                  timerText = "Expired";
              }

              const card = document.createElement('div');
              card.className = 'notif-card-item';
              card.onclick = () => openPendingCheckoutFromData(tx);
              
              card.innerHTML = `
                  <div class="notif-icon-box">
                      <i class="fa-solid fa-bell bell-anim"></i>
                  </div>
                  <div class="notif-card-content">
                      <p class="notif-card-text">
                          Status transaksi ${jenisTransaksi} (<strong>${mataUang}</strong>) anda belum di konfirmasi, batas durasi pesanan (<strong id="notif-timer-${tx.idPesanan}">${timerText}</strong>).
                      </p>
                      <span class="notif-card-action">Buka Halaman Checkout <i class="fa-solid fa-chevron-right" style="font-size:0.7rem;"></i></span>
                  </div>
              `;
              container.appendChild(card);
          });
      }

      function openPendingCheckoutFromData(tx) {
          if (!tx) return;
          activeTxId = tx.idPesanan;
          
          let estimasiVal = tx.estimasi || '-';
          const katLower = (tx.kategori || '').toLowerCase();
          const currencyCode = (tx.mataUang || 'USD').toUpperCase();

          if (katLower === 'beli' && (currencyCode === 'IDR' || String(estimasiVal).toLowerCase().includes('rp'))) {
               let numericVal = parseFloat(String(estimasiVal).replace(/[^0-9]/g, '')) || 0;
               estimasiVal = 'Rp. ' + numericVal.toLocaleString('id-ID');
          }

          document.getElementById('det-trx-id').innerText = `Trx ID: ${tx.idPesanan || '-'}`;
          document.getElementById('det-mata-uang').innerText = currencyCode;
          
          let rateText = '-';
          if (currencyCode === 'USD') {
              let appliedRate = katLower === 'jual' ? liveRates.hargaBeliUsd : liveRates.hargaJualUsd;
              let showRate = appliedRate ? appliedRate.toLocaleString('id-ID') : '-';
              rateText = `1 USD = Rp ${showRate}`;
          }
          document.getElementById('det-rate').innerText = rateText;
          
          document.getElementById('det-diterima').innerText = estimasiVal;
          
          let rawJumlahBayar = String(tx.jumlahBayar || '0');
          document.getElementById('det-nominal').innerText = rawJumlahBayar;
          
          if (rawJumlahBayar.includes('$')) {
              let rawVal = parseFloat(rawJumlahBayar.replace(/[^0-9.]/g, '')) || 0;
              let admin = 0.50;
              document.getElementById('det-admin').innerText = `$ ${admin.toFixed(2)}`;
              document.getElementById('det-total').innerText = `$ ${(rawVal + admin).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
          } else {
              let rawVal = parseFloat(rawJumlahBayar.replace(/\./g, '').replace(/[^0-9]/g, '')) || 0;
              let admin = 2500;
              document.getElementById('det-admin').innerText = `Rp ${admin.toLocaleString('id-ID')}`;
              document.getElementById('det-total').innerText = `Rp ${(rawVal + admin).toLocaleString('id-ID')}`;
          }

          document.getElementById('page-detail-pembayaran').classList.add('open');
          closePendingList();
          
          let remSec = activeExpirations[tx.idPesanan] || tx.remainingSec || 0;
          if (remSec > 0) {
              let mins = Math.floor(remSec / 60);
              let secs = remSec % 60;
              document.getElementById('countdown-timer').innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
          } else {
              document.getElementById('countdown-timer').innerText = "Kadaluarsa";
          }
      }

      function showLogoutModal() { document.getElementById('logout-modal').classList.add('show'); }
      function closeLogoutModal() { document.getElementById('logout-modal').classList.remove('show'); }

      function showCancelModal() { document.getElementById('cancel-modal').classList.add('show'); }
      function closeCancelModal() { document.getElementById('cancel-modal').classList.remove('show'); }

      /* FUNGSI LUPA PASSWORD MODAL & API */
      function openForgotPasswordModal() {
          document.getElementById('forgot-password-modal').classList.add('show');
          showForgotStep(1);
      }

      function closeForgotPasswordModal() {
          document.getElementById('forgot-password-modal').classList.remove('show');
          if(resendInterval) clearInterval(resendInterval);
      }

      function showForgotStep(step) {
          if (step === 1) {
              document.getElementById('forgot-step-1').style.display = 'block';
              document.getElementById('forgot-step-2').style.display = 'none';
          } else {
              document.getElementById('forgot-step-1').style.display = 'none';
              document.getElementById('forgot-step-2').style.display = 'block';
          }
      }

      async function handleSendOtp(e) {
          e.preventDefault();
          const email = document.getElementById('forgot-email').value.trim();
          if (!email) return;

          const btn = document.getElementById('btn-send-otp');
          const origText = btn.innerHTML;
          btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Mengirim OTP...';
          btn.disabled = true;

          try {
              const formData = new URLSearchParams();
              formData.append('action', 'forgot_password_request');
              formData.append('email', email);

              const res = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await res.json();

              if (result.status === 'success') {
                  currentForgotEmail = email;
                  document.getElementById('display-otp-email').innerText = email;
                  showToast("Kode OTP telah dikirim ke email Anda!", "success");
                  showForgotStep(2);
                  startResendTimer();
              } else {
                  showToast(result.message || "Gagal mengirim OTP.");
              }
          } catch(err) {
              showToast("Terjadi kesalahan koneksi.");
          } finally {
              btn.innerHTML = origText;
              btn.disabled = false;
          }
      }

      function startResendTimer() {
          const btnResend = document.getElementById('resend-otp-btn');
          const timerSpan = document.getElementById('resend-timer');
          const countSpan = document.getElementById('resend-count');

          btnResend.style.pointerEvents = 'none';
          btnResend.style.opacity = '0.5';
          timerSpan.style.display = 'inline';

          let count = 60;
          countSpan.innerText = count;

          if (resendInterval) clearInterval(resendInterval);
          resendInterval = setInterval(() => {
              count--;
              countSpan.innerText = count;
              if (count <= 0) {
                  clearInterval(resendInterval);
                  btnResend.style.pointerEvents = 'auto';
                  btnResend.style.opacity = '1';
                  timerSpan.style.display = 'none';
              }
          }, 1000);
      }

      async function resendOtp() {
          if (!currentForgotEmail) return;
          const formData = new URLSearchParams();
          formData.append('action', 'forgot_password_request');
          formData.append('email', currentForgotEmail);

          showToast("Mengirim ulang kode OTP...", "info");
          try {
              const res = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await res.json();
              if (result.status === 'success') {
                  showToast("OTP baru berhasil dikirim!", "success");
                  startResendTimer();
              } else {
                  showToast(result.message || "Gagal mengirim ulang OTP.");
              }
          } catch(err) {
              showToast("Kesalahan jaringan.");
          }
      }

      async function handleResetPassword(e) {
          e.preventDefault();
          const otp = document.getElementById('forgot-otp').value.trim();
          const newPass = document.getElementById('forgot-new-pass').value;
          const confirmPass = document.getElementById('forgot-confirm-pass').value;

          if (newPass !== confirmPass) {
              showToast("Konfirmasi password baru tidak cocok!");
              return;
          }

          const passRegex = /^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z\d]{8,}$/;
          if (!passRegex.test(newPass)) {
              showToast("Password minimal 8 karakter dan wajib kombinasi huruf & angka!");
              return;
          }

          const btn = document.getElementById('btn-reset-pass');
          const origText = btn.innerHTML;
          btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...';
          btn.disabled = true;

          try {
              const formData = new URLSearchParams();
              formData.append('action', 'reset_password_confirm');
              formData.append('email', currentForgotEmail);
              formData.append('otp', otp);
              formData.append('newPassword', newPass);

              const res = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await res.json();

              if (result.status === 'success') {
                  showToast("Password berhasil diperbarui! Silakan masuk.", "success");
                  closeForgotPasswordModal();
                  document.getElementById('form-forgot-request').reset();
                  document.getElementById('form-forgot-reset').reset();
              } else {
                  showToast(result.message || "Gagal mereset password.");
              }
          } catch(err) {
              showToast("Kesalahan koneksi ke server.");
          } finally {
              btn.innerHTML = origText;
              btn.disabled = false;
          }
      }

      function executeLogout() {
          closeLogoutModal();
          localStorage.removeItem('isLoggedIn');
          localStorage.removeItem('userName');
          localStorage.removeItem('userUsername');
          localStorage.removeItem('userEmail');
          
          resetRekeningData();
          
          activeExpirations = {};
          document.getElementById('notif-badge-count').style.display = 'none';
          resetCheckoutState(); 

          const authView = document.getElementById('auth-view');
          authView.style.display = 'block';
          setTimeout(() => { authView.classList.remove('hidden'); }, 10);
          
          document.getElementById('log-user').value = '';
          document.getElementById('log-pass').value = '';
          
          switchTab('home');
          showToast('Anda berhasil keluar.', 'success');
      }

      function switchToRegister() {
          document.getElementById('login-section').classList.remove('active-auth'); document.getElementById('login-section').classList.add('hidden-left');
          document.getElementById('register-section').classList.remove('hidden-right'); document.getElementById('register-section').classList.add('active-auth');
      }
      function switchToLogin() {
          document.getElementById('register-section').classList.remove('active-auth');
          document.getElementById('register-section').classList.add('hidden-right');
          document.getElementById('login-section').classList.remove('hidden-left'); document.getElementById('login-section').classList.add('active-auth');
      }

      function togglePassword(inputId, iconElement) {
          const input = document.getElementById(inputId);
          if (input.type === "password") { input.type = "text"; iconElement.classList.remove('fa-eye'); iconElement.classList.add('fa-eye-slash'); iconElement.style.color = '#10b981'; } 
          else { input.type = "password"; iconElement.classList.remove('fa-eye-slash'); iconElement.classList.add('fa-eye'); iconElement.style.color = ''; }
      }

      function showToast(message, type = 'error') {
          const toast = document.getElementById('floating-toast');
          const toastMsg = document.getElementById('toast-message');
          toastMsg.innerText = message;
          if(type === 'success') { toast.classList.add('success'); toast.querySelector('i').className = 'fa-solid fa-circle-check'; } 
          else { toast.classList.remove('success'); toast.querySelector('i').className = 'fa-solid fa-circle-exclamation'; }
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 3500);
      }

      /* == ALUR VERIFIKASI OTP REGISTRASI == */
      function closeRegisterOtpModal() {
          document.getElementById('register-otp-modal').classList.remove('show');
          if(regResendInterval) clearInterval(regResendInterval);
      }

      function startRegResendTimer() {
          const btnResend = document.getElementById('reg-resend-otp-btn');
          const timerSpan = document.getElementById('reg-resend-timer');
          const countSpan = document.getElementById('reg-resend-count');

          btnResend.style.pointerEvents = 'none';
          btnResend.style.opacity = '0.5';
          timerSpan.style.display = 'inline';

          let count = 60;
          countSpan.innerText = count;

          if (regResendInterval) clearInterval(regResendInterval);
          regResendInterval = setInterval(() => {
              count--;
              countSpan.innerText = count;
              if (count <= 0) {
                  clearInterval(regResendInterval);
                  btnResend.style.pointerEvents = 'auto';
                  btnResend.style.opacity = '1';
                  timerSpan.style.display = 'none';
              }
          } , 1000);
      }

      async function resendRegOtp() {
          if (!currentRegUser || !currentRegEmail) return;
          const formData = new URLSearchParams();
          formData.append('action', 'send_register_otp');
          formData.append('username', currentRegUser);
          formData.append('email', currentRegEmail);

          showToast("Mengirim ulang kode OTP...", "info");
          try {
              const res = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await res.json();
              if (result.status === 'success') {
                  showToast("OTP baru berhasil dikirim!", "success");
                  startRegResendTimer();
              } else {
                  showToast(result.message || "Gagal mengirim ulang OTP.");
              }
          } catch(err) {
              showToast("Kesalahan jaringan.");
          }
      }

      async function handleRegister(e) {
          e.preventDefault();
          const user = document.getElementById('reg-user').value; 
          const email = document.getElementById('reg-email').value;
          const pass = document.getElementById('reg-pass').value;
          
          const passRegex = /^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z\d]{8,}$/;
          if (!passRegex.test(pass)) { showToast("Password minimal 8 karakter dan wajib kombinasi huruf & angka!"); return; }

          document.getElementById('auth-loading').classList.add('show');
          
          const formData = new URLSearchParams();
          formData.append('action', 'send_register_otp'); 
          formData.append('username', user);
          formData.append('email', email);
          
          try {
              const response = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await response.json();
              
              if (result.status === 'success') {
                  currentRegUser = user;
                  currentRegEmail = email;
                  document.getElementById('display-reg-email').innerText = email;
                  document.getElementById('register-otp-modal').classList.add('show');
                  showToast("OTP berhasil dikirim ke email!", "success");
                  startRegResendTimer();
              } else {
                  showToast(result.message || "Username/Email sudah terdaftar."); 
              }
          } catch (error) { 
              showToast("Terjadi kesalahan jaringan."); 
          } finally { 
              document.getElementById('auth-loading').classList.remove('show'); 
          }
      }

      async function handleVerifyRegisterOTP(e) {
          e.preventDefault();
          
          const otp = document.getElementById('reg-otp-input').value;
          const user = document.getElementById('reg-user').value; 
          const email = document.getElementById('reg-email').value;
          const name = document.getElementById('reg-name').value; 
          const hp = document.getElementById('reg-hp').value; 
          const pass = document.getElementById('reg-pass').value;

          const btn = document.getElementById('btn-verify-reg');
          const origText = btn.innerHTML;
          btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Memverifikasi...';
          btn.disabled = true;

          const formData = new URLSearchParams();
          formData.append('action', 'register'); 
          formData.append('username', user);
          formData.append('email', email); 
          formData.append('nama', name); 
          formData.append('hp', hp); 
          formData.append('password', pass);
          formData.append('otp', otp);
          
          try {
              const response = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await response.json();
              if (result.status === 'success') { 
                  showToast("Registrasi Berhasil! Silakan Login.", "success"); 
                  closeRegisterOtpModal();
                  document.getElementById('form-register').reset(); 
                  document.getElementById('form-register-otp').reset();
                  switchToLogin(); 
              } else { 
                  showToast(result.message || "OTP Salah atau Kadaluarsa."); 
              }
          } catch (error) { 
              showToast("Terjadi kesalahan jaringan."); 
          } finally { 
              btn.innerHTML = origText;
              btn.disabled = false;
          }
      }

      async function handleLogin(e) {
          e.preventDefault();
          const user = document.getElementById('log-user').value;
          const pass = document.getElementById('log-pass').value;

          document.getElementById('auth-loading').classList.add('show');
          const formData = new URLSearchParams();
          formData.append('action', 'login'); formData.append('username', user); formData.append('password', pass);
          try {
              const response = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await response.json();
              
              if (result.status === 'success') {
                  showToast(`Selamat datang, ${result.nama}!`, "success");
                  localStorage.setItem('isLoggedIn', 'true');
                  localStorage.setItem('userName', result.nama);
                  localStorage.setItem('userUsername', result.username);
                  localStorage.setItem('userEmail', result.email);

                  document.getElementById('display-user-name').innerText = result.nama;
                  if(document.getElementById('profile-display-name')){ document.getElementById('profile-display-name').innerText = result.nama; }
                  if(document.getElementById('profile-display-email')){ document.getElementById('profile-display-email').innerText = result.email; }

                  const authView = document.getElementById('auth-view');
                  authView.classList.add('hidden');
                  setTimeout(() => { authView.style.display = 'none'; }, 600);
                  loadCurrencyData();
                  fetchPendingData();
              } else { showToast(result.message || "Username atau Password salah."); }
          } catch (error) { showToast("Terjadi kesalahan jaringan."); } 
          finally { document.getElementById('auth-loading').classList.remove('show'); }
      }

      async function openBeliValas() {
          const username = localStorage.getItem('userUsername') || '';
          if (!username) { showToast('Silakan login terlebih dahulu!'); return; }

          const inputNominal = document.getElementById('input-nominal');
          inputNominal.value = '';
          document.getElementById('page-beli-valas').classList.add('open');
          if (typeof updateBeliValasCalculation === 'function') updateBeliValasCalculation();
      }

      function closeBeliValas() {
          document.getElementById('page-beli-valas').classList.remove('open');
          document.getElementById('currency-dropdown-container').classList.remove('dropdown-open');
      }

      async function openJualValas() {
          const username = localStorage.getItem('userUsername') || '';
          if (!username) { showToast('Silakan login terlebih dahulu!'); return; }

          const inputNominal = document.getElementById('input-nominal-jual');
          inputNominal.value = '';
          document.getElementById('page-jual-valas').classList.add('open');
          if (typeof updateJualValasCalculation === 'function') updateJualValasCalculation();
      }

      function closeJualValas() {
          document.getElementById('page-jual-valas').classList.remove('open');
          document.getElementById('currency-dropdown-container-jual').classList.remove('dropdown-open');
      }

     // --- MULAI SCRIPT YANG DIPERBARUI (JS) ---
      let isTxProcessing = false;

      async function prosesLanjutTransaksi() {
          if (isTxProcessing) return; 

          const inputVal = document.getElementById('input-nominal').value;
          const rawNominal = parseFloat(inputVal.replace(/\./g, '')) || 0;
          if (!inputVal || inputVal === '0' || rawNominal === 0) {
              showToast('Masukkan nominal transaksi terlebih dahulu!'); return;
          }

          isTxProcessing = true;
          const btnTx = document.getElementById('btn-lanjut-tx');
          const originalText = btnTx.innerHTML;
          btnTx.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Memproses...';
          btnTx.disabled = true;

          const username = localStorage.getItem('userUsername') || 'unknown';
          const email = localStorage.getItem('userEmail') || 'unknown';
          const nama = localStorage.getItem('userName') || 'Pengguna';
          const mataUang = document.getElementById('selected-code').innerText || '-';
          const prefixBayar = document.getElementById('prefix-input-nominal').innerText || '';
          const jumlahBayar = `${prefixBayar} ${inputVal}`;
          const estimasi = document.getElementById('estimasi-diterima').innerText || '-';
          
          const formData = new URLSearchParams();
          formData.append('action', 'transaksi');
          formData.append('username', username);
          formData.append('email', email);
          formData.append('nama', nama);
          formData.append('kategori', 'Beli');
          formData.append('mataUang', mataUang);
          formData.append('jumlahBayar', jumlahBayar);
          formData.append('estimasi', estimasi);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000);

          try {
              const response = await fetch(GAS_URL, { 
                  method: 'POST', 
                  body: formData,
                  signal: controller.signal
              });
              
              clearTimeout(timeoutId);
              
              const contentType = response.headers.get("content-type");
              if (!response.ok || (contentType && contentType.includes("text/html"))) {
                  throw new Error("Server_Error");
              }

              const result = await response.json();
              
              if(result.status === 'success') {
                  activeTxId = result.idPesanan;
                  openDetailPembayaranWithData(result.idPesanan, result.remainingSec);
                  fetchPendingData();
              } else {
                  showToast(result.message || "Gagal menyimpan transaksi.");
              }
          } catch (e) { 
              if (e.name === 'AbortError') {
                  showToast("Jaringan sibuk, transaksi dibatalkan otomatis.");
              } else {
                  showToast("Akses tidak dikenali atau terjadi kesalahan koneksi.");
              }
              // [TAMBAHAN] Menghapus data transaksi yang sudah terlanjur masuk jika terjadi koneksi timeout/error
              hapusTransaksiNyangkut(username, jumlahBayar, 'Beli');
          } 
          finally { 
              btnTx.innerHTML = originalText; 
              btnTx.disabled = false; 
              isTxProcessing = false; 
          }
      }

      async function prosesLanjutTransaksiJual() {
          if (isTxProcessing) return; 

          const inputVal = document.getElementById('input-nominal-jual').value;
          const rawNominal = parseFloat(inputVal.replace(/\./g, '')) || 0;
          if (!inputVal || inputVal === '0' || rawNominal === 0) {
              showToast('Masukkan nominal transaksi terlebih dahulu!'); return;
          }

          isTxProcessing = true;
          const btnTx = document.getElementById('btn-lanjut-tx-jual');
          const originalText = btnTx.innerHTML;
          btnTx.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Memproses...';
          btnTx.disabled = true;

          const username = localStorage.getItem('userUsername') || 'unknown';
          const email = localStorage.getItem('userEmail') || 'unknown';
          const nama = localStorage.getItem('userName') || 'Pengguna';
          const mataUang = document.getElementById('selected-code-jual').innerText || '-';
          const prefixBayar = document.getElementById('prefix-input-nominal-jual').innerText || '';
          const jumlahBayar = `${prefixBayar} ${inputVal}`;
          const estimasi = document.getElementById('estimasi-diterima-jual').innerText || '-';
          
          const formData = new URLSearchParams();
          formData.append('action', 'transaksi');
          formData.append('username', username);
          formData.append('email', email);
          formData.append('nama', nama);
          formData.append('kategori', 'Jual');
          formData.append('mataUang', mataUang);
          formData.append('jumlahBayar', jumlahBayar);
          formData.append('estimasi', estimasi);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000);

          try {
              const response = await fetch(GAS_URL, { 
                  method: 'POST', 
                  body: formData,
                  signal: controller.signal
              });
              
              clearTimeout(timeoutId);
              
              const contentType = response.headers.get("content-type");
              if (!response.ok || (contentType && contentType.includes("text/html"))) {
                  throw new Error("Server_Error");
              }

              const result = await response.json();
              
              if(result.status === 'success') {
                  activeTxId = result.idPesanan;
                  openDetailPembayaranWithDataJual(result.idPesanan, result.remainingSec);
                  fetchPendingData();
              } else {
                  showToast(result.message || "Gagal menyimpan transaksi.");
              }
          } catch (e) { 
              if (e.name === 'AbortError') {
                  showToast("Jaringan sibuk, transaksi dibatalkan otomatis.");
              } else {
                  showToast("Akses tidak dikenali atau terjadi kesalahan koneksi.");
              }
              // [TAMBAHAN] Menghapus data transaksi yang sudah terlanjur masuk jika terjadi koneksi timeout/error
              hapusTransaksiNyangkut(username, jumlahBayar, 'Jual');
          } 
          finally { 
              btnTx.innerHTML = originalText; 
              btnTx.disabled = false;
              isTxProcessing = false; 
          }
      }

      // [TAMBAHAN] Fungsi baru untuk menghapus otomatis transaksi yang menggantung
      function hapusTransaksiNyangkut(username, jumlahBayar, kategori) {
          const formData = new URLSearchParams();
          formData.append('action', 'rollback_transaksi');
          formData.append('username', username);
          formData.append('jumlahBayar', jumlahBayar);
          formData.append('kategori', kategori);
          try {
              fetch(GAS_URL, { method: 'POST', body: formData });
          } catch(err) {
              console.log('Gagal membatalkan transaksi nyangkut', err);
          }
      }
      // --- SELESAI SCRIPT YANG DIPERBARUI (JS) ---
      
      function openDetailPembayaranWithData(idPesanan, remainingSec) {
          const inputVal = document.getElementById('input-nominal').value;
          const rawNominal = parseFloat(inputVal.replace(/\./g, '')) || 0;
          const currencyCode = document.getElementById('selected-code').innerText || '-';
          const rateInfo = document.getElementById('info-rate-valas').innerText || '-';
          const bayarPrefix = document.getElementById('prefix-input-nominal').innerText || '';
          
          let estimasiVal = document.getElementById('estimasi-diterima').innerText || '-';
          if (currencyCode === 'IDR' || estimasiVal.toLowerCase().includes('rp')) {
               let numericVal = parseFloat(estimasiVal.toString().replace(/[^0-9]/g, '')) || 0;
               estimasiVal = 'Rp. ' + numericVal.toLocaleString('id-ID');
          }

          document.getElementById('det-mata-uang').innerText = currencyCode;
          document.getElementById('det-rate').innerText = rateInfo;
          document.getElementById('det-diterima').innerText = estimasiVal;
          document.getElementById('det-nominal').innerText = `${bayarPrefix} ${inputVal}`;
          
          let adminFee = 0; let totalBayar = 0;
          if (bayarPrefix === '$') {
              adminFee = 0.50; totalBayar = rawNominal + adminFee;
              document.getElementById('det-admin').innerText = `$ ${adminFee.toFixed(2)}`;
              document.getElementById('det-total').innerText = `$ ${totalBayar.toLocaleString('en-US', {minimumFractionDigits:2})}`;
          } else {
              adminFee = 2500; totalBayar = rawNominal + adminFee;
              document.getElementById('det-admin').innerText = `Rp ${adminFee.toLocaleString('id-ID')}`;
              document.getElementById('det-total').innerText = `Rp ${totalBayar.toLocaleString('id-ID')}`;
          }
          document.getElementById('det-trx-id').innerText = `Trx ID: ${idPesanan}`;
          
          activeExpirations[idPesanan] = remainingSec || 900; 
          document.getElementById('page-detail-pembayaran').classList.add('open');
      }

     function openDetailPembayaranWithData(idPesanan, remainingSec) {
    const inputVal = document.getElementById('input-nominal').value;
    const rawNominal = parseFloat(inputVal.replace(/\./g, '')) || 0;
    const currencyCode = document.getElementById('selected-code').innerText || '-';
    const rateInfo = document.getElementById('info-rate-valas').innerText || '-';
    const bayarPrefix = document.getElementById('prefix-input-nominal').innerText || '';
    
    let estimasiVal = document.getElementById('estimasi-diterima').innerText || '-';
    if (currencyCode === 'IDR' || estimasiVal.toLowerCase().includes('rp')) {
        let numericVal = parseFloat(estimasiVal.toString().replace(/[^0-9]/g, '')) || 0;
        estimasiVal = 'Rp. ' + numericVal.toLocaleString('id-ID');
    }
    
    document.getElementById('det-mata-uang').innerText = currencyCode;
    document.getElementById('det-rate').innerText = rateInfo;
    document.getElementById('det-diterima').innerText = estimasiVal;
    document.getElementById('det-nominal').innerText = `${bayarPrefix} ${inputVal}`;
    
    // --- PERUBAHAN BIAYA ADMIN DINAMIS ---
    let adminFee = 0;
    let totalBayar = 0;
    
    if (bayarPrefix === '$') {
        adminFee = getBiayaLayananDynamic('USD'); // Mengambil dari sheet
        totalBayar = rawNominal + adminFee;
        document.getElementById('det-admin').innerText = `$ ${adminFee.toFixed(2)}`;
        document.getElementById('det-total').innerText = `$ ${totalBayar.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    } else {
        adminFee = getBiayaLayananDynamic('IDR'); // Mengambil dari sheet
        totalBayar = rawNominal + adminFee;
        document.getElementById('det-admin').innerText = `Rp ${adminFee.toLocaleString('id-ID')}`;
        document.getElementById('det-total').innerText = `Rp ${totalBayar.toLocaleString('id-ID')}`;
    }
    
    document.getElementById('det-trx-id').innerText = `Trx ID: ${idPesanan}`;
    activeExpirations[idPesanan] = remainingSec || 900;
    document.getElementById('page-detail-pembayaran').classList.add('open');
}

function openDetailPembayaranWithDataJual(idPesanan, remainingSec) {
    const inputVal = document.getElementById('input-nominal-jual').value;
    const rawNominal = parseFloat(inputVal.replace(/\./g, '')) || 0;
    const currencyCode = document.getElementById('selected-code-jual').innerText || '-';
    const rateInfo = document.getElementById('info-rate-valas-jual').innerText || '-';
    const bayarPrefix = document.getElementById('prefix-input-nominal-jual').innerText || '';
    
    let estimasiVal = document.getElementById('estimasi-diterima-jual').innerText || '-';
    if (currencyCode === 'USD' || estimasiVal.toLowerCase().includes('rp')) {
        let numericVal = parseFloat(estimasiVal.toString().replace(/[^0-9]/g, '')) || 0;
        estimasiVal = 'Rp. ' + numericVal.toLocaleString('id-ID');
    }
    
    document.getElementById('det-mata-uang').innerText = currencyCode;
    document.getElementById('det-rate').innerText = rateInfo;
    document.getElementById('det-diterima').innerText = estimasiVal;
    document.getElementById('det-nominal').innerText = `${bayarPrefix} ${inputVal}`;
    
    // --- PERUBAHAN BIAYA ADMIN DINAMIS ---
    let adminFee = 0;
    let totalBayar = 0;
    
    if (bayarPrefix === '$') {
        adminFee = getBiayaLayananDynamic('USD'); // Mengambil dari sheet
        totalBayar = rawNominal + adminFee;
        document.getElementById('det-admin').innerText = `$ ${adminFee.toFixed(2)}`;
        document.getElementById('det-total').innerText = `$ ${totalBayar.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    } else {
        adminFee = getBiayaLayananDynamic('IDR'); // Mengambil dari sheet
        totalBayar = rawNominal + adminFee;
        document.getElementById('det-admin').innerText = `Rp ${adminFee.toLocaleString('id-ID')}`;
        document.getElementById('det-total').innerText = `Rp ${totalBayar.toLocaleString('id-ID')}`;
    }
    
    document.getElementById('det-trx-id').innerText = `Trx ID: ${idPesanan}`;
    activeExpirations[idPesanan] = remainingSec || 900;
    document.getElementById('page-detail-pembayaran').classList.add('open');
}

      async function executeBatalPesanan() {
          closeCancelModal();
          const btnBatal = document.getElementById('btn-batal-pesanan');
          const originalText = btnBatal.innerHTML;
          btnBatal.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Membatalkan...';
          btnBatal.disabled = true;
          
          const username = localStorage.getItem('userUsername') || '';
          const formData = new URLSearchParams();
          formData.append('action', 'batal_transaksi');
          formData.append('username', username);
          formData.append('idPesanan', activeTxId);
          
          try {
              const response = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await response.json();

              if(result.status === 'success') {
                  showToast('Pesanan berhasil dibatalkan.', 'success');
                  delete activeExpirations[activeTxId];
                  activeTxId = "";
                  
                  closeAllToHome();
                  fetchPendingData();
                  loadTransactions();
              } else { showToast(result.message || 'Gagal membatalkan pesanan.'); }
          } catch(e) { showToast('Terjadi kesalahan koneksi.'); } 
          finally { btnBatal.innerHTML = originalText; btnBatal.disabled = false; }
      }

      function closeAllToHome() {
          document.getElementById('page-metode-pembayaran').classList.remove('open');
          document.getElementById('page-detail-pembayaran').classList.remove('open');
          document.getElementById('page-beli-valas').classList.remove('open');
          document.getElementById('page-jual-valas').classList.remove('open');
          document.getElementById('page-informasi').classList.remove('open');
          document.getElementById('page-laporan').classList.remove('open');
      }
      
      function openPaymentPage() { document.getElementById('page-metode-pembayaran').classList.add('open'); }
      function closePaymentPage() { document.getElementById('page-metode-pembayaran').classList.remove('open'); }

      function switchPaymentTab(tabId) {
          document.querySelectorAll('.capsule-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.payment-tab-content').forEach(c => c.style.display = 'none');
          
          if (tabId === 'rupiah') {
              document.getElementById('tab-btn-rupiah').classList.add('active');
              document.getElementById('content-rupiah').style.display = 'block';
          } else {
              document.getElementById('tab-btn-dollar').classList.add('active');
              document.getElementById('content-dollar').style.display = 'block';
          }
      }

      function copyRekening(norek) {
          navigator.clipboard.writeText(norek).then(() => {
              showToast('Nomor rekening berhasil disalin!', 'success');
          }).catch(err => {
              const el = document.createElement('textarea');
              el.value = norek; document.body.appendChild(el); el.select();
              document.execCommand('copy'); document.body.removeChild(el);
              showToast('Nomor rekening berhasil disalin!', 'success');
          });
      }

      document.getElementById('file-upload-input').addEventListener('change', function(e) {
          if(e.target.files.length > 0) {
              const fileName = e.target.files[0].name;
              document.getElementById('upload-text-label').innerText = fileName;
              document.getElementById('upload-icon').className = 'fa-solid fa-file-circle-check';
              document.getElementById('upload-icon').style.color = '#10b981';
          }
      });

      async function prosesKonfirmasi() {
          if (!activeTxId) {
              showToast('Tidak ada transaksi aktif yang bisa dikonfirmasi.');
              return;
          }

          const btnKonfirm = document.getElementById('btn-konfirmasi-action');
          const originalText = btnKonfirm.innerHTML;
          
          const isRupiah = document.getElementById('tab-btn-rupiah').classList.contains('active');
          const jenisRekening = isRupiah ? 'Rekening Rupiah' : 'Rekening Dollar';
          
          const rate = document.getElementById('det-rate').innerText;
          const biayaLayanan = document.getElementById('det-admin').innerText;
          const totalTagihan = document.getElementById('det-total').innerText;
          
          const fileInput = document.getElementById('file-upload-input');
          const file = fileInput.files[0];

          if (!file) {
              showToast('Mohon upload bukti pembayaran terlebih dahulu!');
              return;
          }

          btnKonfirm.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Memproses...';
          btnKonfirm.disabled = true;

          const submitData = async (fileBase64 = '', fileName = '', mimeType = '') => {
              const formData = new URLSearchParams();
              formData.append('action', 'konfirmasi');
              formData.append('idPesanan', activeTxId);
              formData.append('jenisRekening', jenisRekening);
              formData.append('rate', rate);
              formData.append('biayaLayanan', biayaLayanan);
              formData.append('totalTagihan', totalTagihan);
              formData.append('fileData', fileBase64);
              formData.append('fileName', fileName);
              formData.append('mimeType', mimeType);

              try {
                  const response = await fetch(GAS_URL, { method: 'POST', body: formData });
                  const result = await response.json();
                  
                  if (result.status === 'success') {
                      showToast('Pembayaran Anda berhasil dikonfirmasi!', 'success');
                      delete activeExpirations[activeTxId];
                      activeTxId = "";
                      
                      // --- TAMBAHAN RESET FORM UPLOAD BUKTI PEMBAYARAN ---
const fileInput = document.getElementById('file-upload-input');
if (fileInput) {
    fileInput.value = '';
}

// Mengembalikan teks label ke awal
const uploadLabel = document.getElementById('upload-text-label');
if (uploadLabel) {
    uploadLabel.innerText = 'Ketuk untuk upload struk';
}

// Mengembalikan icon ke awal
const uploadIcon = document.getElementById('upload-icon');
if (uploadIcon) {
    uploadIcon.className = 'fa-solid fa-cloud-arrow-up';
    uploadIcon.style.color = '';
}
                      
                      setTimeout(() => {
                          closeAllToHome();
                          fetchPendingData();
                          loadTransactions();
                      }, 1500);
                  } else {
                      showToast(result.message || 'Gagal mengonfirmasi pembayaran.');
                  }
              } catch (e) {
                  showToast('Terjadi kesalahan jaringan.');
              } finally {
                  btnKonfirm.innerHTML = originalText;
                  btnKonfirm.disabled = false;
              }
          };

          if (file) {
              const reader = new FileReader();
              reader.onload = function(e) {
                  const base64Data = e.target.result.split(',')[1];
                  submitData(base64Data, file.name, file.type);
              };
              reader.onerror = function() {
                  showToast('Gagal memproses file Struk.');
                  btnKonfirm.innerHTML = originalText;
                  btnKonfirm.disabled = false;
              };
              reader.readAsDataURL(file);
          } else {
              submitData(); 
          }
      }
      
      function toggleDropdown() { document.getElementById('currency-dropdown-container').classList.toggle('dropdown-open'); }
      function toggleDropdownJual() { document.getElementById('currency-dropdown-container-jual').classList.toggle('dropdown-open'); }
      
      function selectCurrency(code, name, flagUrl) {
          document.getElementById('selected-code').innerText = code;
          document.getElementById('selected-name').innerText = name;
          document.getElementById('selected-flag').src = flagUrl; document.getElementById('select-currency').value = code;
          document.getElementById('currency-dropdown-container').classList.remove('dropdown-open'); updateBeliValasCalculation();
      }

      function selectCurrencyJual(code, name, flagUrl) {
          document.getElementById('selected-code-jual').innerText = code;
          document.getElementById('selected-name-jual').innerText = name;
          document.getElementById('selected-flag-jual').src = flagUrl; document.getElementById('select-currency-jual').value = code;
          document.getElementById('currency-dropdown-container-jual').classList.remove('dropdown-open'); updateJualValasCalculation();
      }
      
      document.addEventListener('click', function(event) {
          const container = document.getElementById('currency-dropdown-container');
          if (container && !container.contains(event.target)) { container.classList.remove('dropdown-open'); }
          
          const containerJual = document.getElementById('currency-dropdown-container-jual');
          if (containerJual && !containerJual.contains(event.target)) { containerJual.classList.remove('dropdown-open'); }
      });

      document.addEventListener("DOMContentLoaded", () => {
        startGlobalTicker();
        checkAuth();
        
        const slider = document.getElementById('banner-slider'); const dots = document.querySelectorAll('.dot');
        let currentSlide = 0; const totalSlides = dots.length;
        setInterval(() => {
            currentSlide = (currentSlide + 1) % totalSlides;
            slider.style.transform = `translateX(-${currentSlide * 100}%)`;
            dots.forEach((dot, index) => { dot.classList.toggle('active', index === currentSlide); dot.classList.toggle('inactive', index !== currentSlide); });
        }, 3500);
        
        setInterval(() => {
            if (localStorage.getItem('isLoggedIn') === 'true') {
                fetchPendingData();
            }
        }, 30000);
      });

      function formatAndCalculateValas(input) {
          let value = input.value.replace(/[^0-9]/g, '');
          input.value = value ? parseInt(value, 10).toLocaleString('id-ID') : '';
          updateBeliValasCalculation();
      }

      function formatAndCalculateValasJual(input) {
          let value = input.value.replace(/[^0-9]/g, '');
          input.value = value ? parseInt(value, 10).toLocaleString('id-ID') : '';
          updateJualValasCalculation();
      }

      /* FUNGSI JS ANIMASI MUNCULKAN GAMBAR/KODE QR DOLLAR */
      function toggleDollarQR() {
          const wrapper = document.getElementById('dollar-img-wrapper');
          const btn = document.getElementById('btn-show-qr');
          wrapper.classList.toggle('show');
          if (wrapper.classList.contains('show')) {
              btn.innerHTML = '<i class="fa-solid fa-eye-slash" style="margin-right: 5px;"></i> Sembunyikan QR / Rekening';
              btn.classList.add('active-btn-qr');
          } else {
              btn.innerHTML = '<i class="fa-solid fa-qrcode" style="margin-right: 5px;"></i> Tampilkan Kode QR / Rekening';
              btn.classList.remove('active-btn-qr');
          }
      }

      let liveRates = { usdToIdr: 0, hargaBeliUsd: 0, hargaJualUsd: 0, lastUpdatedTime: '' };
      
      function updateBeliValasCalculation() {
          const selectedCurrency = document.getElementById('select-currency').value;
          const rawNominal = parseFloat(document.getElementById('input-nominal').value.replace(/\./g, '')) || 0;
          const estimasiEl = document.getElementById('estimasi-diterima');
          estimasiEl.style.opacity = '0.5'; estimasiEl.style.transform = 'scale(0.98)';
          
          setTimeout(() => {
              if (selectedCurrency === 'USD') {
                  document.getElementById('label-input-nominal').innerText = 'Jumlah Bayar (Rupiah)';
                  document.getElementById('prefix-input-nominal').innerText = 'Rp';
                  document.getElementById('min-tx-note').innerHTML = '<i class="fa-solid fa-circle-info"></i> Minimal transaksi Rp 500.000';
                  
                  if (liveRates.hargaJualUsd > 0) {
                      if (rawNominal === 0) { estimasiEl.innerText = 'USD 0.00'; } 
                      else { estimasiEl.innerText = `USD ${(rawNominal / liveRates.hargaJualUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
                      document.getElementById('info-rate-valas').innerText = `1 USD = Rp ${liveRates.hargaJualUsd.toLocaleString('id-ID')}`;
                  } else if (rawNominal === 0) { estimasiEl.innerText = 'USD 0.00'; }
              } else if (selectedCurrency === 'IDR') {
                  document.getElementById('label-input-nominal').innerText = 'Jumlah Bayar (USD)';
                  document.getElementById('prefix-input-nominal').innerText = '$';
                  document.getElementById('min-tx-note').innerHTML = '<i class="fa-solid fa-circle-info"></i> Minimal transaksi $ 50';
                  
                  if (liveRates.hargaBeliUsd > 0) {
                      if (rawNominal === 0) { estimasiEl.innerText = 'Rp. 0'; } 
                      else { estimasiEl.innerText = `Rp. ${Math.round(rawNominal * liveRates.hargaBeliUsd).toLocaleString('id-ID')}`; }
                      document.getElementById('info-rate-valas').innerText = `1 USD = Rp ${liveRates.hargaBeliUsd.toLocaleString('id-ID')}`;
                  } else if (rawNominal === 0) { estimasiEl.innerText = 'Rp. 0'; }
              }
              if (liveRates.lastUpdatedTime) { document.getElementById('info-update-time').innerText = `${liveRates.lastUpdatedTime} WIB`; }
              estimasiEl.style.opacity = '1'; estimasiEl.style.transform = 'scale(1)';
          }, 150);
      }

      function updateJualValasCalculation() {
          const selectedCurrency = document.getElementById('select-currency-jual').value;
          const rawNominal = parseFloat(document.getElementById('input-nominal-jual').value.replace(/\./g, '')) || 0;
          const estimasiEl = document.getElementById('estimasi-diterima-jual');
          estimasiEl.style.opacity = '0.5'; estimasiEl.style.transform = 'scale(0.98)';
          
          setTimeout(() => {
              if (selectedCurrency === 'USD') {
                  document.getElementById('label-input-nominal-jual').innerText = 'Jumlah Jual (USD)';
                  document.getElementById('prefix-input-nominal-jual').innerText = '$';
                  document.getElementById('min-tx-note-jual').innerHTML = '<i class="fa-solid fa-circle-info"></i> Minimal transaksi $ 50';
                  
                  if (liveRates.hargaBeliUsd > 0) {
                      if (rawNominal === 0) { estimasiEl.innerText = 'Rp. 0'; } 
                      else { estimasiEl.innerText = `Rp. ${Math.round(rawNominal * liveRates.hargaBeliUsd).toLocaleString('id-ID')}`; }
                      document.getElementById('info-rate-valas-jual').innerText = `1 USD = Rp ${liveRates.hargaBeliUsd.toLocaleString('id-ID')}`;
                  } else if (rawNominal === 0) { estimasiEl.innerText = 'Rp. 0'; }
              } else if (selectedCurrency === 'IDR') {
                  document.getElementById('label-input-nominal-jual').innerText = 'Jumlah Jual (Rupiah)';
                  document.getElementById('prefix-input-nominal-jual').innerText = 'Rp';
                  document.getElementById('min-tx-note-jual').innerHTML = '<i class="fa-solid fa-circle-info"></i> Minimal transaksi Rp 500.000';
                  
                  if (liveRates.hargaJualUsd > 0) {
                      if (rawNominal === 0) { estimasiEl.innerText = 'USD 0.00'; } 
                      else { estimasiEl.innerText = `USD ${(rawNominal / liveRates.hargaJualUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
                      document.getElementById('info-rate-valas-jual').innerText = `1 USD = Rp ${liveRates.hargaJualUsd.toLocaleString('id-ID')}`;
                  } else if (rawNominal === 0) { estimasiEl.innerText = 'USD 0.00'; }
              }
              if (liveRates.lastUpdatedTime) { document.getElementById('info-update-time-jual').innerText = `${liveRates.lastUpdatedTime} WIB`; }
              estimasiEl.style.opacity = '1'; estimasiEl.style.transform = 'scale(1)';
          }, 150);
      }

      async function loadCurrencyData() {
          try {
              const response = await fetch('https://open.er-api.com/v6/latest/USD');
              const data = await response.json();
              const currentIdr = data.rates.IDR; const margin = 100;
              
              liveRates = {
                  usdToIdr: currentIdr, hargaBeliUsd: Math.round(currentIdr - margin), hargaJualUsd: Math.round(currentIdr + margin),
                  lastUpdatedTime: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
              };
              
              const formatAngka = (angka) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(angka);
              const elBeli = document.getElementById('usd-beli'); const elJual = document.getElementById('usd-jual');
              const elRate = document.getElementById('currentRate');
              
              elBeli.classList.remove('skeleton-text'); elJual.classList.remove('skeleton-text'); elRate.classList.remove('skeleton-text');
              elBeli.innerText = formatAngka(liveRates.hargaBeliUsd); elJual.innerText = formatAngka(liveRates.hargaJualUsd); elRate.innerText = 'Rp ' + formatAngka(currentIdr);
              updateBeliValasCalculation();
              updateJualValasCalculation();
              
              const ctx = document.getElementById('kursChart').getContext('2d');
              if (window.myKursChart) { window.myKursChart.destroy(); }
              const gradient = ctx.createLinearGradient(0, 0, 0, 200);
              gradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)'); gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
              
              window.myKursChart = new Chart(ctx, {
                  type: 'line',
                  data: {
                      labels: ['H-6', 'H-5', 'H-4', 'H-3', 'H-2', 'Kemarin', 'Hari Ini'],
                      datasets: [{ label: 'Nilai Tukar (Rp)', data: [currentIdr * 0.991, currentIdr * 0.994, currentIdr * 0.989, currentIdr * 0.998, currentIdr * 0.995, currentIdr * 0.999, currentIdr], borderColor: '#ffffff', backgroundColor: gradient, borderWidth: 3, pointBackgroundColor: '#FFD700', pointBorderColor: '#ffffff', pointBorderWidth: 2, pointRadius: 5, fill: true, tension: 0.4 }]
                  },
                  options: {
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', titleFont: { size: 13 }, bodyFont: { size: 14, weight: 'bold' }, displayColors: false, callbacks: { label: function(context) { return 'Rp ' + context.parsed.y.toLocaleString('id-ID'); } } } },
                      scales: { x: { ticks: { color: 'rgba(255,255,255,0.9)', font: { size: 10 } }, grid: { display: false } }, y: { ticks: { display: false }, grid: { display: false } } }
                  }
              });
          } catch (error) { console.error('Error fetching API:', error); }
      }
      
      /* FITUR METODE PEMBAYARAN (REKENING) */
      function openEditRekening() {
          document.getElementById('page-edit-rekening').classList.add('open');
          loadRekeningData(); // Tarik data sebelumnya saat modal dibuka
      }

      function closeEditRekening() {
          document.getElementById('page-edit-rekening').classList.remove('open');
      }

      async function loadRekeningData() {
          const username = localStorage.getItem('userUsername');
          if(!username) return;
          
          try {
              const formData = new URLSearchParams();
              formData.append('action', 'get_rekening');
              formData.append('username', username);
              
              const response = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await response.json();
              
              if (result.status === 'success' && result.data) {
                  document.getElementById('rek-bank').value = result.data.bank || '';
                  document.getElementById('rek-nomor').value = result.data.nomor || '';
                  document.getElementById('rek-nama').value = result.data.atas_nama || '';
              }
          } catch(e) {
              console.log("Belum ada data rekening atau gagal memuat.");
          }
      }

      async function handleSaveRekening(e) {
          e.preventDefault();
          const username = localStorage.getItem('userUsername');
          if(!username) {
              showToast("Sesi Anda habis, silakan login kembali.");
              return;
          }

          const bank = document.getElementById('rek-bank').value.trim();
          const nomor = document.getElementById('rek-nomor').value.trim();
          const nama = document.getElementById('rek-nama').value.trim();
          const btn = document.getElementById('btn-save-rekening');
          
          const origText = btn.innerHTML;
          btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...';
          btn.disabled = true;

          try {
              const formData = new URLSearchParams();
              formData.append('action', 'save_rekening');
              formData.append('username', username);
              formData.append('bank', bank);
              formData.append('nomor', nomor);
              formData.append('atas_nama', nama);

              const response = await fetch(GAS_URL, { method: 'POST', body: formData });
              const result = await response.json();

              if (result.status === 'success') {
                  showToast("Data rekening berhasil disimpan!", "success");
                  setTimeout(() => closeEditRekening(), 1500);
              } else {
                  showToast(result.message || "Gagal menyimpan rekening.");
              }
          } catch(err) {
              showToast("Terjadi kesalahan jaringan.");
          } finally {
              btn.innerHTML = origText;
              btn.disabled = false;
          }
      }
      
      /* =========================================
         FITUR EDIT PROFIL & CROP FOTO BARU
         ========================================= */
let cropper = null;
let fotoProfilBase64 = null;

// Event listener agar foto profil tersimpan teraplikasi saat aplikasi dibuka/direfresh
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const savedFoto = localStorage.getItem('userFoto');
        if (savedFoto) {
            document.querySelectorAll('.avatar-img, .upc-avatar').forEach(img => img.src = savedFoto);
        }
    }, 500);
});

function openEditProfil() {
    document.getElementById('page-edit-profil').classList.add('open');
    
    // Isi otomatis form sesuai data localStorage (Username & Email readonly)
    document.getElementById('edit-prof-user').value = localStorage.getItem('userUsername') || '';
    document.getElementById('edit-prof-email').value = localStorage.getItem('userEmail') || '';
    document.getElementById('edit-prof-name').value = localStorage.getItem('userName') || '';
    document.getElementById('edit-prof-hp').value = localStorage.getItem('userHp') || '';
    
    // Set foto saat ini
    const savedFoto = localStorage.getItem('userFoto');
    const defaultAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${localStorage.getItem('userName') || 'Budi'}`;
    document.getElementById('preview-foto-profil').src = savedFoto || defaultAvatar;
}

function closeEditProfil() {
    document.getElementById('page-edit-profil').classList.remove('open');
}

function handleFotoPilih(event) {
    const file = event.target.files[0];
    if (file) {
        if (file.size > 2 * 1024 * 1024) { // Batas 2MB
            showToast("Ukuran foto maksimal 2MB");
            event.target.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('image-to-crop').src = e.target.result;
            document.getElementById('modal-crop-foto').classList.add('show');
            
            // Inisialisasi Cropper.js
            if (cropper) cropper.destroy();
            cropper = new Cropper(document.getElementById('image-to-crop'), {
                aspectRatio: 1, // Memaksa potong kotak (1:1)
                viewMode: 1,
                autoCropArea: 1,
            });
        };
        reader.readAsDataURL(file);
    }
}

function batalCrop() {
    document.getElementById('modal-crop-foto').classList.remove('show');
    document.getElementById('input-foto-profil').value = '';
    if (cropper) cropper.destroy();
}

function simpanCrop() {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({
        width: 400,
        height: 400,
    });
    
    // Konversi hasil potong menjadi Base64
    fotoProfilBase64 = canvas.toDataURL('image/jpeg', 0.8);
    document.getElementById('preview-foto-profil').src = fotoProfilBase64;
    
    document.getElementById('modal-crop-foto').classList.remove('show');
    if (cropper) cropper.destroy();
}

async function handleSaveProfil(e) {
    e.preventDefault();
    
    const username = document.getElementById('edit-prof-user').value;
    const nama = document.getElementById('edit-prof-name').value;
    const hp = document.getElementById('edit-prof-hp').value;
    const passwordBaru = document.getElementById('edit-prof-pass').value;
    
    const btn = document.getElementById('btn-save-profil');
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...';
    btn.disabled = true;
    
    try {
        const formData = new URLSearchParams();
        formData.append('action', 'update_profil');
        formData.append('username', username);
        formData.append('nama', nama);
        formData.append('hp', hp);
        formData.append('password', passwordBaru);
        if (fotoProfilBase64) {
            formData.append('foto', fotoProfilBase64);
        }
        
        const response = await fetch(GAS_URL, { method: 'POST', body: formData });
        const result = await response.json();
        
        if (result.status === 'success') {
            showToast('Profil berhasil diperbarui!', 'success');
            
            // Update data di penyimpanan lokal HP user
            localStorage.setItem('userName', nama);
            localStorage.setItem('userHp', hp);
            if (fotoProfilBase64) {
                localStorage.setItem('userFoto', fotoProfilBase64);
                document.querySelectorAll('.avatar-img, .upc-avatar').forEach(img => img.src = fotoProfilBase64);
            }
            
            // Update tampilan UI langsung
            document.getElementById('display-user-name').innerText = nama;
            if (document.getElementById('profile-display-name')) {
                document.getElementById('profile-display-name').innerText = nama;
            }
            
            setTimeout(() => closeEditProfil(), 1000);
        } else {
            showToast("Gagal memperbarui profil: " + result.message);
        }
    } catch (error) {
        showToast("Terjadi kesalahan koneksi internet.");
        console.error(error);
    } finally {
        btn.innerHTML = origHtml;
        btn.disabled = false;
    }
}

// ==========================================
// FUNGSI PUSAT BANTUAN & WHATSAPP ADMIN
// ==========================================

function openBantuan() {
    document.getElementById('page-bantuan').classList.add('open');
    fetchWaAdmin(); // Mulai tarik nomor WA saat halaman dibuka
}

function closeBantuan() {
    document.getElementById('page-bantuan').classList.remove('open');
}

async function fetchWaAdmin() {
    const btnWa = document.getElementById('btn-wa-admin');
    const iconWa = document.getElementById('wa-loading-icon');
    const textWa = document.getElementById('wa-btn-text');
    
    // Status awal: Loading animasi
    btnWa.style.pointerEvents = 'none';
    btnWa.style.opacity = '0.7';
    btnWa.style.background = 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)';
    btnWa.style.boxShadow = 'none';
    iconWa.className = 'fa-solid fa-circle-notch fa-spin';
    textWa.innerText = 'Memuat Kontak...';
    
    const formData = new URLSearchParams();
    formData.append('action', 'get_wa_admin');
    
    try {
        const response = await fetch(GAS_URL, { method: 'POST', body: formData });
        const result = await response.json();
        
        if (result.status === 'success' && result.noWa) {
            // Berhasil: Tombol Aktif & Hijau WA
            btnWa.href = `https://wa.me/${result.noWa}`;
            btnWa.style.pointerEvents = 'auto';
            btnWa.style.opacity = '1';
            btnWa.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            btnWa.style.boxShadow = '0 10px 25px -5px rgba(16, 185, 129, 0.5)';
            iconWa.className = 'fa-brands fa-whatsapp';
            textWa.innerText = 'Chat via WhatsApp';
        } else {
            // Error dari Database
            iconWa.className = 'fa-solid fa-triangle-exclamation';
            textWa.innerText = 'Admin Belum Tersedia';
            if (typeof showToast === "function") showToast("Gagal memuat kontak. Pastikan sheet Kontak WA terisi.", "error");
        }
    } catch (e) {
        console.error("Gagal memuat WA admin", e);
        // Error Jaringan
        iconWa.className = 'fa-solid fa-wifi';
        textWa.innerText = 'Koneksi Terputus';
    }
}

/* --- FUNGSI ANIMASI & REALTIME ATM CARD --- */
function toggleEditRekForm() {
    const formContainer = document.getElementById('form-rek-container');
    formContainer.classList.toggle('show');
}

function updateAtmView() {
    const bankInput = document.getElementById('rek-bank').value || 'BANK KAMU';
    const norekInput = document.getElementById('rek-nomor').value || '**** **** **** ****';
    const namaInput = document.getElementById('rek-nama').value || 'NAMA PENGGUNA';
    
    document.getElementById('display-bank-name').innerText = bankInput.toUpperCase();
    document.getElementById('display-rek-number').innerText = formatRekeningNumber(norekInput);
    document.getElementById('display-holder-name').innerText = namaInput.toUpperCase();
}

// Fungsi untuk memformat nomor rekening agar ada spasi tiap 4 digit (mirip kartu asli)
function formatRekeningNumber(number) {
    if (number === '**** **** **** ****' || !number) return '**** **** **** ****';
    return number.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();
}

// Fungsi untuk membuka halaman Edit Rekening dan mengambil data dari Sheet 'Rekening'
async function openEditRekening() {
    document.getElementById('page-edit-rekening').classList.add('open');
    
    const username = localStorage.getItem('userUsername');
    if (!username) {
        if (typeof showToast === 'function') showToast('Silakan login terlebih dahulu');
        return;
    }
    
   // Memunculkan efek loading animasi Holographic Scanner pada Kartu ATM
document.getElementById('atm-loading-overlay').classList.add('active');
    
    try {
        const formData = new URLSearchParams();
        // Pastikan action 'get_rekening' sesuai dengan penamaan di backend GAS Anda
        formData.append('action', 'get_rekening');
        formData.append('username', username);
        
        const response = await fetch(GAS_URL, { method: 'POST', body: formData });
        const result = await response.json();
        
        if (result.status === 'success' && result.data) {
            // Mapping respons dari sheet Rekening (sesuaikan atribut 'bank', 'nomorRekening', 'atasNama' dengan output json GAS Anda)
            const bank = result.data.bank || 'BANK KAMU';
            const noRek = result.data.nomor || '**** **** **** ****';
            const nama = result.data.atas_nama || 'NAMA PENGGUNA';
            
            // Isi otomatis input form yang tersembunyi
            document.getElementById('rek-bank').value = bank !== 'BANK KAMU' ? bank : '';
            document.getElementById('rek-nomor').value = noRek !== '**** **** **** ****' ? noRek : '';
            document.getElementById('rek-nama').value = nama !== 'NAMA PENGGUNA' ? nama : '';
            
            // Perbarui tampilan Kartu ATM secara realtime menggunakan data yang didapat
            updateAtmView();
        } else {
            // Jika belum ada data rekening tersimpan, kembalikan ke default
            updateAtmView();
        }
    } catch (error) {
        console.error("Gagal memuat data rekening:", error);
        updateAtmView(); // Fallback jika fetch error
    }
    
    // Mematikan/menghilangkan efek loading setelah data selesai dimuat
document.getElementById('atm-loading-overlay').classList.remove('active');
}

// Fungsi untuk mereset tampilan dan form metode pembayaran
function resetRekeningData() {
    // 1. Mengosongkan form input
    if (document.getElementById('rek-bank')) document.getElementById('rek-bank').value = '';
    if (document.getElementById('rek-nomor')) document.getElementById('rek-nomor').value = '';
    if (document.getElementById('rek-nama')) document.getElementById('rek-nama').value = '';
    
    // 2. Mereset tampilan Kartu ATM Modern ke teks default
    if (document.getElementById('display-bank-name')) document.getElementById('display-bank-name').innerText = 'BANK KAMU';
    if (document.getElementById('display-rek-number')) document.getElementById('display-rek-number').innerText = '**** **** **** ****';
    if (document.getElementById('display-holder-name')) document.getElementById('display-holder-name').innerText = 'NAMA PENGGUNA';
    
    // 3. Menyembunyikan form edit jika keadaannya sedang terbuka
    const formContainer = document.getElementById('form-rek-container');
    if (formContainer && formContainer.classList.contains('show')) {
        formContainer.classList.remove('show');
    }
}
