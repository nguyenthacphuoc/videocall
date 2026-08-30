let currentUser = null;
let currentList = 'all';
let callTimer = null;
let callSeconds = 0;
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isMuted = false;
let isVideoOff = false;
let isScreenSharing = false;
let screenStream = null;
let incomingCallData = null;
let currentPeerId = null;
let callDocRef = null;
let pollInterval = null;

const servers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

auth.onAuthStateChanged((user) => {
    currentUser = user;
    if (user) {
        updateUIForLoggedInUser(user);
        updateUserOnlineStatus(user.uid, true);
        startPollingForCalls();
        listenForFriendRequests();
    } else {
        updateUIForLoggedOutUser();
        stopPollingForCalls();
    }
    loadUsers();
});

async function updateUserOnlineStatus(userId, isOnline) {
    try {
        await db.collection('users').doc(userId).update({
            isOnline: isOnline,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {}
}

window.addEventListener('beforeunload', () => {
    if (currentUser) {
        db.collection('users').doc(currentUser.uid).update({ isOnline: false }).catch(() => {});
    }
});

function updateUIForLoggedInUser(user) {
    document.getElementById('guestButtons').style.display = 'none';
    document.getElementById('userInfo').style.display = 'flex';
    document.getElementById('userName').textContent = `👤 ${user.displayName || user.email}`;
}

function updateUIForLoggedOutUser() {
    document.getElementById('guestButtons').style.display = 'flex';
    document.getElementById('userInfo').style.display = 'none';
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;top:20px;right:20px;padding:15px 25px;border-radius:10px;color:white;font-weight:600;z-index:99999;background:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1'};`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function showLoading() { document.getElementById('loadingSpinner').style.display = 'flex'; }
function hideLoading() { document.getElementById('loadingSpinner').style.display = 'none'; }

function openModal(modalId) { document.getElementById(modalId).style.display = 'block'; }
function closeModal(modalId) { document.getElementById(modalId).style.display = 'none'; }

window.onclick = function(event) {
    if (event.target.classList.contains('modal') && event.target.id !== 'callModal') {
        event.target.style.display = 'none';
    }
}

function showLogin() { closeModal('registerModal'); openModal('loginModal'); }
function showRegister() { closeModal('loginModal'); openModal('registerModal'); }

function showAddFriend() {
    if (currentUser) { openModal('addFriendModal'); }
    else { showToast('Vui lòng đăng nhập!', 'error'); showLogin(); }
}

// ============ POLLING ============
function startPollingForCalls() {
    stopPollingForCalls();
    console.log('👂 Lắng nghe cuộc gọi...');
    
    pollInterval = setInterval(async () => {
        if (!currentUser) return;
        
        try {
            const doc = await db.collection('calls').doc(currentUser.uid).get();
            
            if (doc.exists) {
                const data = doc.data();
                
                if (data.status === 'ringing' && data.calleeId === currentUser.uid && !incomingCallData && !peerConnection) {
                    incomingCallData = data;
                    const accept = confirm(`📞 ${data.callerName} đang gọi video!\n\nChấp nhận cuộc gọi?`);
                    
                    if (accept) {
                        await acceptCall(data);
                    } else {
                        await db.collection('calls').doc(currentUser.uid).delete().catch(() => {});
                        incomingCallData = null;
                    }
                }
                
                if (data.status === 'answered' && data.answer && peerConnection) {
                    try {
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                        document.getElementById('callStatus').textContent = '✅ Đã kết nối!';
                    } catch (err) {}
                }
                
                if (data.status === 'ended' && peerConnection) {
                    endCall();
                }
            }
        } catch (error) {}
    }, 2000);
}

function stopPollingForCalls() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// ============ ĐĂNG KÝ ============
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    showLoading();
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await userCredential.user.updateProfile({ displayName: name });
        await db.collection('users').doc(userCredential.user.uid).set({
            name, email, friends: [], friendRequests: [], isOnline: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        hideLoading();
        closeModal('registerModal');
        document.getElementById('registerForm').reset();
        showToast('Đăng ký thành công!', 'success');
        showLogin();
    } catch (error) {
        hideLoading();
        let message = 'Đăng ký thất bại!';
        if (error.code === 'auth/email-already-in-use') message = 'Email đã được sử dụng!';
        document.getElementById('registerError').textContent = message;
    }
});

// ============ ĐĂNG NHẬP ============
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    showLoading();
    try {
        await auth.signInWithEmailAndPassword(email, password);
        hideLoading();
        closeModal('loginModal');
        document.getElementById('loginForm').reset();
        showToast('Đăng nhập thành công!', 'success');
    } catch (error) {
        hideLoading();
        let message = 'Đăng nhập thất bại!';
        if (error.code === 'auth/user-not-found') message = 'Email không tồn tại!';
        if (error.code === 'auth/wrong-password') message = 'Mật khẩu không đúng!';
        document.getElementById('loginError').textContent = message;
    }
});

async function logout() {
    if (currentUser) await updateUserOnlineStatus(currentUser.uid, false);
    await auth.signOut();
    showToast('Đã đăng xuất!', 'info');
}

// ============ KẾT BẠN ============
document.getElementById('addFriendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) { showToast('Vui lòng đăng nhập!', 'error'); return; }
    const friendEmail = document.getElementById('friendEmail').value.trim();
    if (friendEmail === currentUser.email) { document.getElementById('friendError').textContent = 'Không thể kết bạn với chính mình!'; return; }
    showLoading();
    try {
        const snapshot = await db.collection('users').where('email', '==', friendEmail).get();
        if (snapshot.empty) { document.getElementById('friendError').textContent = 'Không tìm thấy email!'; hideLoading(); return; }
        const friendDoc = snapshot.docs[0];
        const friendId = friendDoc.id;
        const friendData = friendDoc.data();
        const currentUserDoc = await db.collection('users').doc(currentUser.uid).get();
        const currentData = currentUserDoc.data();
        const friends = currentData.friends || [];
        if (friends.includes(friendId)) { document.getElementById('friendError').textContent = 'Đã là bạn bè!'; hideLoading(); return; }
        const friendRequests = friendData.friendRequests || [];
        if (friendRequests.some(r => r.userId === currentUser.uid)) { document.getElementById('friendError').textContent = 'Đã gửi lời mời!'; hideLoading(); return; }
        friendRequests.push({ userId: currentUser.uid, name: currentUser.displayName || currentUser.email, email: currentUser.email, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        await db.collection('users').doc(friendId).update({ friendRequests });
        hideLoading();
        closeModal('addFriendModal');
        document.getElementById('addFriendForm').reset();
        showToast(`Đã gửi lời mời đến ${friendData.name}!`, 'success');
        loadUsers();
    } catch (error) { hideLoading(); }
});

function listenForFriendRequests() {
    if (!currentUser) return;
    db.collection('users').doc(currentUser.uid).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            const friendRequests = data.friendRequests || [];
            if (friendRequests.length > 0) {
                const request = friendRequests[0];
                if (confirm(`🤝 ${request.name} muốn kết bạn! Chấp nhận?`)) acceptFriendRequest(request);
                else declineFriendRequest(request);
            }
        }
    });
}

async function acceptFriendRequest(request) {
    const currentUserDoc = await db.collection('users').doc(currentUser.uid).get();
    const currentData = currentUserDoc.data();
    const myFriends = currentData.friends || [];
    myFriends.push(request.userId);
    await db.collection('users').doc(currentUser.uid).update({ friends: myFriends, friendRequests: [] });
    const friendDoc = await db.collection('users').doc(request.userId).get();
    const friendData = friendDoc.data();
    const friendFriends = friendData.friends || [];
    friendFriends.push(currentUser.uid);
    await db.collection('users').doc(request.userId).update({ friends: friendFriends });
    showToast(`Đã kết bạn với ${request.name}!`, 'success');
    loadUsers();
}

async function declineFriendRequest(request) {
    const currentUserDoc = await db.collection('users').doc(currentUser.uid).get();
    const currentData = currentUserDoc.data();
    const friendRequests = currentData.friendRequests || [];
    const updatedRequests = friendRequests.filter(r => r.userId !== request.userId);
    await db.collection('users').doc(currentUser.uid).update({ friendRequests: updatedRequests });
}

async function quickAddFriend(friendId) {
    if (!currentUser) return;
    const friendDoc = await db.collection('users').doc(friendId).get();
    const friendData = friendDoc.data();
    const currentUserDoc = await db.collection('users').doc(currentUser.uid).get();
    const currentData = currentUserDoc.data();
    const friends = currentData.friends || [];
    if (friends.includes(friendId)) { showToast('Đã là bạn bè!', 'error'); return; }
    const friendRequests = friendData.friendRequests || [];
    if (friendRequests.some(r => r.userId === currentUser.uid)) { showToast('Đã gửi lời mời!', 'error'); return; }
    friendRequests.push({ userId: currentUser.uid, name: currentUser.displayName || currentUser.email, email: currentUser.email, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    await db.collection('users').doc(friendId).update({ friendRequests });
    showToast(`Đã gửi lời mời đến ${friendData.name}!`, 'success');
    loadUsers();
}

// ============ LOAD USERS ============
async function loadUsers() {
    showLoading();
    try {
        const snapshot = await db.collection('users').limit(50).get();
        const userGrid = document.getElementById('userGrid');
        userGrid.innerHTML = '';
        let users = [];
        snapshot.docs.forEach(doc => {
            const user = doc.data();
            if (doc.id === currentUser?.uid) return;
            users.push({ id: doc.id, ...user });
        });
        if (currentList === 'friends' && currentUser) {
            const currentUserDoc = await db.collection('users').doc(currentUser.uid).get();
            const currentData = currentUserDoc.data();
            const friends = currentData.friends || [];
            users = users.filter(user => friends.includes(user.id));
        }
        if (currentList === 'online') users = users.filter(user => user.isOnline === true);
        if (users.length === 0) {
            userGrid.innerHTML = '<p style="text-align:center;padding:40px;color:#64748b;">Không có người dùng nào.</p>';
            hideLoading();
            return;
        }
        for (const user of users) {
            const isFriend = currentUser ? (user.friends || []).includes(currentUser.uid) : false;
            const hasPendingRequest = currentUser ? (user.friendRequests || []).some(r => r.userId === currentUser.uid) : false;
            const card = document.createElement('div');
            card.className = 'user-card';
            card.innerHTML = `
                <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}&background=6366f1&color=fff&size=100" class="user-avatar">
                <h3>${user.name || 'User'}</h3>
                <span class="user-status ${user.isOnline ? 'status-online' : 'status-offline'}">${user.isOnline ? '🟢 Online' : '⚫ Offline'}</span>
                <p class="user-email">${user.email}</p>
                <div class="user-actions">
                    ${isFriend ? `<button class="btn-call" onclick="startCall('${user.id}', '${user.name}')">📞 Gọi Video</button>` : ''}
                    ${!isFriend && !hasPendingRequest && currentUser ? `<button class="btn-add" onclick="quickAddFriend('${user.id}')">+ Kết Bạn</button>` : ''}
                    ${hasPendingRequest ? `<span style="color:#f59e0b;">⏳ Đã gửi lời mời</span>` : ''}
                </div>
            `;
            userGrid.appendChild(card);
        }
    } catch (error) {
        document.getElementById('userGrid').innerHTML = '<p>Lỗi: ' + error.message + '</p>';
    } finally { hideLoading(); }
}

// ============ WEBRTC ============
async function startCall(calleeId, calleeName) {
    if (!currentUser) { showToast('Vui lòng đăng nhập!', 'error'); return; }
    
    try {
        const calleeDoc = await db.collection('users').doc(calleeId).get();
        const calleeData = calleeDoc.data();
        if (!calleeData.isOnline) { showToast(`${calleeName} đang offline!`, 'error'); return; }
        
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('callStatus').textContent = `📞 Đang gọi ${calleeName}...`;
        document.getElementById('callDuration').textContent = '00:00';
        openModal('callModal');
        
        currentPeerId = calleeId;
        callDocRef = db.collection('calls').doc(calleeId);
        
        peerConnection = new RTCPeerConnection(servers);
        remoteStream = new MediaStream();
        document.getElementById('remoteVideo').srcObject = remoteStream;
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => {
                remoteStream.addTrack(track);
            });
            document.getElementById('remoteVideo').srcObject = remoteStream;
        };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        await callDocRef.set({
            offer: { type: offer.type, sdp: offer.sdp },
            callerId: currentUser.uid,
            callerName: currentUser.displayName || currentUser.email,
            calleeId: calleeId,
            calleeName: calleeName,
            status: 'ringing',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        startCallTimer();
        
    } catch (error) {
        console.error('Error:', error);
        showToast('Không thể truy cập camera!', 'error');
    }
}

async function acceptCall(data) {
    try {
        currentPeerId = data.callerId;
        callDocRef = db.collection('calls').doc(currentUser.uid);
        
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('callStatus').textContent = `📞 Đang nói chuyện với ${data.callerName}`;
        document.getElementById('callDuration').textContent = '00:00';
        openModal('callModal');
        
        peerConnection = new RTCPeerConnection(servers);
        remoteStream = new MediaStream();
        document.getElementById('remoteVideo').srcObject = remoteStream;
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => {
                remoteStream.addTrack(track);
            });
            document.getElementById('remoteVideo').srcObject = remoteStream;
        };
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        await callDocRef.update({
            answer: { type: answer.type, sdp: answer.sdp },
            status: 'answered'
        });
        
        startCallTimer();
        incomingCallData = null;
        
    } catch (error) {
        console.error('Error:', error);
        incomingCallData = null;
    }
}

function startCallTimer() {
    callSeconds = 0;
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(() => {
        callSeconds++;
        const minutes = Math.floor(callSeconds / 60);
        const seconds = callSeconds % 60;
        document.getElementById('callDuration').textContent = 
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

// ============ CHIA SẺ MÀN HÌNH ============
async function toggleScreenShare() {
    if (!peerConnection) { showToast('Chưa có cuộc gọi!', 'error'); return; }
    try {
        if (!isScreenSharing) {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) await sender.replaceTrack(screenTrack);
            document.getElementById('localVideo').srcObject = screenStream;
            screenTrack.onended = () => toggleScreenShare();
            isScreenSharing = true;
            document.getElementById('screenShareBtn').textContent = '🖥️ Đang chia sẻ';
            showToast('Đang chia sẻ màn hình!', 'success');
        } else {
            if (screenStream) screenStream.getTracks().forEach(track => track.stop());
            const cameraTrack = localStream.getVideoTracks()[0];
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
            document.getElementById('localVideo').srcObject = localStream;
            isScreenSharing = false;
            document.getElementById('screenShareBtn').textContent = '🖥️';
            showToast('Đã dừng chia sẻ!', 'info');
        }
    } catch (error) {
        showToast('Không thể chia sẻ màn hình!', 'error');
    }
}

function toggleMute() {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => { track.enabled = !track.enabled; });
        isMuted = !isMuted;
        document.getElementById('muteBtn').textContent = isMuted ? '🔇' : '🎤';
    }
}

function toggleVideo() {
    if (localStream) {
        localStream.getVideoTracks().forEach(track => { track.enabled = !track.enabled; });
        isVideoOff = !isVideoOff;
        document.getElementById('videoBtn').textContent = isVideoOff ? '🚫' : '📹';
    }
}

function endCall() {
    if (callTimer) { clearInterval(callTimer); callTimer = null; }
    
    if (callDocRef) {
        callDocRef.update({ status: 'ended' }).catch(() => {});
    }
    
    setTimeout(() => {
        if (peerConnection) { peerConnection.close(); peerConnection = null; }
        if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
        if (screenStream) { screenStream.getTracks().forEach(track => track.stop()); screenStream = null; }
    }, 500);
    
    setTimeout(() => {
        if (callDocRef) { callDocRef.delete().catch(() => {}); callDocRef = null; }
    }, 3000);
    
    isScreenSharing = false;
    isMuted = false;
    isVideoOff = false;
    callSeconds = 0;
    incomingCallData = null;
    currentPeerId = null;
    
    closeModal('callModal');
}

function showAllUsers() {
    currentList = 'all';
    document.getElementById('listTitle').textContent = '👥 Tất Cả Người Dùng';
    loadUsers();
}

function showFriends() {
    currentList = 'friends';
    document.getElementById('listTitle').textContent = '🤝 Bạn Bè';
    loadUsers();
}

function showOnlineUsers() {
    currentList = 'online';
    document.getElementById('listTitle').textContent = '🟢 Online';
    loadUsers();
}

document.addEventListener('DOMContentLoaded', () => {
    loadUsers();
});
