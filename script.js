let currentUser = null;
let jitsiApi = null;

auth.onAuthStateChanged((user) => {
    currentUser = user;
    if (user) {
        document.getElementById('guestButtons').style.display = 'none';
        document.getElementById('userInfo').style.display = 'flex';
        document.getElementById('userName').textContent = '👤 ' + (user.displayName || user.email);
        document.getElementById('publicRoomsCard').style.display = 'block';
        setUserOnline(user.uid, true);
        listenForFriendRequests();
        loadPublicRooms();
    } else {
        document.getElementById('guestButtons').style.display = 'flex';
        document.getElementById('userInfo').style.display = 'none';
        document.getElementById('publicRoomsCard').style.display = 'none';
    }
    loadUsers();
});

// ============ ONLINE STATUS ============
async function setUserOnline(userId, isOnline) {
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

// ============ MODAL ============
function openModal(id) { document.getElementById(id).style.display = 'block'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showLogin() { closeModal('registerModal'); closeModal('addFriendModal'); openModal('loginModal'); }
function showRegister() { closeModal('loginModal'); closeModal('addFriendModal'); openModal('registerModal'); }
function showAddFriend() { closeModal('loginModal'); closeModal('registerModal'); openModal('addFriendModal'); }

// ============ AUTH ============
async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { alert('Nhập đầy đủ!'); return; }
    
    try {
        await auth.signInWithEmailAndPassword(email, password);
        closeModal('loginModal');
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';
        alert('✅ Đăng nhập thành công!');
    } catch (error) {
        alert('❌ ' + error.message);
    }
}

async function handleRegister() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    if (!name || !email || !password) { alert('Nhập đầy đủ!'); return; }
    
    try {
        const result = await auth.createUserWithEmailAndPassword(email, password);
        await result.user.updateProfile({ displayName: name });
        await db.collection('users').doc(result.user.uid).set({
            name, email,
            friends: [],
            friendRequests: [],
            isOnline: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal('registerModal');
        document.getElementById('regName').value = '';
        document.getElementById('regEmail').value = '';
        document.getElementById('regPassword').value = '';
        alert('✅ Đăng ký thành công!');
    } catch (error) {
        alert('❌ ' + error.message);
    }
}

async function logout() {
    if (currentUser) await setUserOnline(currentUser.uid, false);
    if (jitsiApi) { jitsiApi.dispose(); jitsiApi = null; }
    await auth.signOut();
}

// ============ PHÒNG CÔNG KHAI ============
async function createRoom() {
    if (!currentUser) { alert('Đăng nhập trước!'); return; }
    
    const roomId = Math.random().toString(36).substring(7);
    
    try {
        await db.collection('public_rooms').add({
            roomId: roomId,
            createdBy: currentUser.uid,
            creatorName: currentUser.displayName || currentUser.email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            active: true
        });
        
        document.getElementById('roomId').value = roomId;
        joinCall();
        alert('✅ Đã tạo phòng: ' + roomId);
        loadPublicRooms();
    } catch (error) {
        alert('❌ ' + error.message);
    }
}

async function loadPublicRooms() {
    const roomList = document.getElementById('publicRoomsList');
    if (!roomList) return;
    
    try {
        const snapshot = await db.collection('public_rooms')
            .where('active', '==', true)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();
        
        if (snapshot.empty) {
            roomList.innerHTML = '<p style="color:#64748b;text-align:center;">Chưa có phòng nào đang mở.</p>';
            return;
        }
        
        roomList.innerHTML = '';
        
        snapshot.docs.forEach(doc => {
            const room = doc.data();
            const div = document.createElement('div');
            div.className = 'room-item';
            div.innerHTML = `
                <div>
                    <strong>📞 ${room.roomId}</strong>
                    <p style="font-size:0.8rem;color:#64748b;">Tạo bởi: ${room.creatorName}</p>
                </div>
                <button class="btn btn-primary" onclick="joinRoom('${room.roomId}')">Tham Gia</button>
            `;
            roomList.appendChild(div);
        });
    } catch (error) {
        console.error('Error:', error);
    }
}

function joinRoom(roomId) {
    document.getElementById('roomId').value = roomId;
    joinCall();
}

// ============ JITSI MEET (8x8.vc - Không giới hạn) ============
function joinCall() {
    const roomId = document.getElementById('roomId').value.trim();
    if (!roomId) { alert('Nhập ID phòng!'); return; }
    
    const videoContainer = document.getElementById('videoContainer');
    videoContainer.style.display = 'block';
    
    const options = {
        roomName: 'videocall-' + roomId,
        width: '100%',
        height: 500,
        parentNode: document.getElementById('jitsiContainer'),
        userInfo: { displayName: currentUser ? (currentUser.displayName || currentUser.email) : 'Khách' },
        configOverwrite: {
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableDeepLinking: true
        },
        interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false
        }
    };
    
    if (jitsiApi) jitsiApi.dispose();
    
    // Dùng 8x8.vc - Không giới hạn thời gian
    jitsiApi = new JitsiMeetExternalAPI('8x8.vc', options);
    
    // Full màn hình
    setTimeout(() => {
        const container = document.getElementById('videoContainer');
        if (container.requestFullscreen) container.requestFullscreen();
    }, 1000);
    
    // Khi rời phòng
    jitsiApi.on('readyToClose', () => {
        exitCall();
    });
}

function exitCall() {
    if (jitsiApi) {
        jitsiApi.dispose();
        jitsiApi = null;
    }
    
    if (document.fullscreenElement) document.exitFullscreen();
    
    document.getElementById('videoContainer').style.display = 'none';
    document.getElementById('jitsiContainer').innerHTML = '';
}

// ============ KẾT BẠN ============
async function handleAddFriend() {
    if (!currentUser) { alert('Đăng nhập trước!'); return; }
    
    const friendEmail = document.getElementById('friendEmail').value.trim();
    if (!friendEmail) { alert('Nhập email!'); return; }
    if (friendEmail === currentUser.email) { alert('Không thể kết bạn với chính mình!'); return; }
    
    try {
        const snapshot = await db.collection('users').where('email', '==', friendEmail).get();
        if (snapshot.empty) { alert('Không tìm thấy email!'); return; }
        
        const friendDoc = snapshot.docs[0];
        const friendData = friendDoc.data();
        const theirRequests = friendData.friendRequests || [];
        
        if (theirRequests.some(r => r.userId === currentUser.uid)) {
            alert('Đã gửi lời mời!');
            return;
        }
        
        theirRequests.push({
            userId: currentUser.uid,
            name: currentUser.displayName || currentUser.email,
            email: currentUser.email
        });
        
        await db.collection('users').doc(friendDoc.id).update({ friendRequests: theirRequests });
        closeModal('addFriendModal');
        document.getElementById('friendEmail').value = '';
        alert('✅ Đã gửi lời mời!');
        loadUsers();
    } catch (error) {
        alert('❌ ' + error.message);
    }
}

function listenForFriendRequests() {
    if (!currentUser) return;
    
    db.collection('users').doc(currentUser.uid).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            const requests = data.friendRequests || [];
            if (requests.length > 0) {
                const req = requests[0];
                if (confirm(`🤝 ${req.name} muốn kết bạn! Chấp nhận?`)) {
                    acceptFriend(req);
                } else {
                    declineFriend(req);
                }
            }
        }
    });
}

async function acceptFriend(req) {
    const myDoc = await db.collection('users').doc(currentUser.uid).get();
    const myData = myDoc.data();
    const myFriends = myData.friends || [];
    if (!myFriends.includes(req.userId)) myFriends.push(req.userId);
    await db.collection('users').doc(currentUser.uid).update({ friends: myFriends, friendRequests: [] });
    
    const theirDoc = await db.collection('users').doc(req.userId).get();
    const theirData = theirDoc.data();
    const theirFriends = theirData.friends || [];
    if (!theirFriends.includes(currentUser.uid)) theirFriends.push(currentUser.uid);
    await db.collection('users').doc(req.userId).update({ friends: theirFriends });
    
    alert('✅ Đã kết bạn!');
    loadUsers();
}

async function declineFriend(req) {
    const myDoc = await db.collection('users').doc(currentUser.uid).get();
    const myData = myDoc.data();
    const requests = myData.friendRequests || [];
    const updated = requests.filter(r => r.userId !== req.userId);
    await db.collection('users').doc(currentUser.uid).update({ friendRequests: updated });
}

// ============ LOAD USERS ============
async function loadUsers() {
    try {
        const snapshot = await db.collection('users').limit(50).get();
        const userGrid = document.getElementById('userGrid');
        if (!userGrid) return;
        userGrid.innerHTML = '';
        
        let count = 0;
        snapshot.docs.forEach(doc => {
            const user = doc.data();
            if (doc.id === currentUser?.uid) return;
            count++;
            
            const isFriend = currentUser ? (user.friends || []).includes(currentUser.uid) : false;
            const hasPending = currentUser ? (user.friendRequests || []).some(r => r.userId === currentUser.uid) : false;
            
            const card = document.createElement('div');
            card.className = 'user-card';
            card.innerHTML = `
                <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}&background=6366f1&color=fff&size=80" style="border-radius:50%;">
                <h3>${user.name || 'User'}</h3>
                <p style="color:${user.isOnline ? '#10b981' : '#64748b'};">${user.isOnline ? '🟢 Online' : '⚫ Offline'}</p>
                <p style="font-size:0.8rem;color:#64748b;">${user.email}</p>
                ${isFriend ? '<p style="color:#10b981;">✅ Bạn bè</p>' : hasPending ? '<p style="color:#f59e0b;">⏳ Đã gửi</p>' : currentUser ? `<button class="btn btn-warning" onclick="quickAdd('${doc.id}')">+ Kết Bạn</button>` : ''}
            `;
            userGrid.appendChild(card);
        });
        
        if (count === 0) {
            userGrid.innerHTML = '<p style="text-align:center;color:#64748b;padding:20px;">Chưa có người dùng khác.</p>';
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function quickAdd(friendId) {
    if (!currentUser) return;
    
    const friendDoc = await db.collection('users').doc(friendId).get();
    const friendData = friendDoc.data();
    const theirRequests = friendData.friendRequests || [];
    
    if (theirRequests.some(r => r.userId === currentUser.uid)) {
        alert('Đã gửi lời mời!');
        return;
    }
    
    theirRequests.push({
        userId: currentUser.uid,
        name: currentUser.displayName || currentUser.email,
        email: currentUser.email
    });
    await db.collection('users').doc(friendId).update({ friendRequests: theirRequests });
    alert('✅ Đã gửi lời mời!');
    loadUsers();
}

function showAllUsers() { loadUsers(); }
function showFriends() { loadUsers(); }
function showOnlineUsers() { loadUsers(); }

loadUsers();
