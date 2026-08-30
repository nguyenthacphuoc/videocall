// Firebase đã được khởi tạo trong firebase-config.js

let currentUser = null;
let currentList = 'all';

// Theo dõi trạng thái đăng nhập
auth.onAuthStateChanged((user) => {
    currentUser = user;
    if (user) {
        showMainSection(user);
        setUserOnline(user.uid, true);
        listenForFriendRequests();
    } else {
        showAuthSection();
    }
    loadUsers();
});

// ============ UI ============
function showMainSection(user) {
    document.getElementById('authSection').style.display = 'none';
    document.getElementById('mainSection').style.display = 'block';
    document.getElementById('userName').textContent = '👤 ' + (user.displayName || user.email);
}

function showAuthSection() {
    document.getElementById('authSection').style.display = 'block';
    document.getElementById('mainSection').style.display = 'none';
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;top:20px;right:20px;padding:15px 25px;border-radius:10px;color:white;font-weight:600;z-index:99999;background:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1'};`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

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

// ============ ĐĂNG KÝ / ĐĂNG NHẬP ============
let isLogin = false;

function toggleAuthMode() {
    isLogin = !isLogin;
    document.getElementById('authTitle').textContent = isLogin ? 'Đăng Nhập' : 'Đăng Ký';
    document.getElementById('authBtn').textContent = isLogin ? 'Đăng Nhập' : 'Đăng Ký';
    document.getElementById('toggleLink').textContent = isLogin ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập';
}

async function handleAuth() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    
    if (!email || !password) {
        alert('Vui lòng nhập email và mật khẩu!');
        return;
    }
    
    try {
        if (isLogin) {
            const result = await auth.signInWithEmailAndPassword(email, password);
            console.log('✅ Đăng nhập thành công!');
        } else {
            const result = await auth.createUserWithEmailAndPassword(email, password);
            // Tạo user trong Firestore
            await db.collection('users').doc(result.user.uid).set({
                name: email.split('@')[0],
                email: email,
                friends: [],
                friendRequests: [],
                isOnline: true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('✅ Đăng ký thành công!');
        }
        
        document.getElementById('email').value = '';
        document.getElementById('password').value = '';
        
    } catch (error) {
        let message = 'Lỗi!';
        if (error.code === 'auth/email-already-in-use') message = 'Email đã được sử dụng!';
        if (error.code === 'auth/user-not-found') message = 'Email không tồn tại!';
        if (error.code === 'auth/wrong-password') message = 'Mật khẩu không đúng!';
        if (error.code === 'auth/weak-password') message = 'Mật khẩu quá yếu!';
        alert(message);
    }
}

async function logout() {
    if (currentUser) await setUserOnline(currentUser.uid, false);
    await auth.signOut();
    showToast('Đã đăng xuất!', 'info');
}

// ============ JITSI MEET ============
let jitsiApi = null;

function createRoom() {
    const roomId = Math.random().toString(36).substring(7);
    document.getElementById('roomId').value = roomId;
    joinCall();
    showToast('✅ Đã tạo phòng: ' + roomId, 'success');
}

function joinCall() {
    const roomId = document.getElementById('roomId').value.trim();
    if (!roomId) {
        alert('Vui lòng nhập ID phòng!');
        return;
    }
    
    document.getElementById('videoContainer').style.display = 'block';
    
    const domain = 'meet.jit.si';
    const options = {
        roomName: 'videocall-' + roomId,
        width: '100%',
        height: 500,
        parentNode: document.getElementById('jitsiContainer'),
        userInfo: {
            displayName: currentUser ? (currentUser.displayName || currentUser.email) : 'User'
        },
        configOverwrite: {
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            enableClosePage: false
        },
        interfaceConfigOverwrite: {
            filmStripOnly: false,
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false,
            SHOW_PROMOTIONAL_CLOSE_PAGE: false
        }
    };
    
    if (jitsiApi) jitsiApi.dispose();
    jitsiApi = new JitsiMeetExternalAPI(domain, options);
    
    showToast('📞 Đã tham gia phòng: ' + roomId, 'success');
}

// ============ KẾT BẠN ============
async function sendFriendRequest() {
    if (!currentUser) { alert('Vui lòng đăng nhập!'); return; }
    
    const friendEmail = document.getElementById('friendEmail').value.trim();
    if (!friendEmail) { alert('Vui lòng nhập email!'); return; }
    if (friendEmail === currentUser.email) { alert('Không thể kết bạn với chính mình!'); return; }
    
    try {
        const snapshot = await db.collection('users').where('email', '==', friendEmail).get();
        
        if (snapshot.empty) {
            alert('Không tìm thấy email này!');
            return;
        }
        
        const friendDoc = snapshot.docs[0];
        const friendId = friendDoc.id;
        const friendData = friendDoc.data();
        
        // Kiểm tra đã là bạn
        const myDoc = await db.collection('users').doc(currentUser.uid).get();
        const myData = myDoc.data();
        const myFriends = myData.friends || [];
        
        if (myFriends.includes(friendId)) {
            alert('Đã là bạn bè!');
            return;
        }
        
        // Kiểm tra đã gửi lời mời
        const theirRequests = friendData.friendRequests || [];
        if (theirRequests.some(r => r.userId === currentUser.uid)) {
            alert('Đã gửi lời mời!');
            return;
        }
        
        // Gửi lời mời
        theirRequests.push({
            userId: currentUser.uid,
            name: myData.name || currentUser.email,
            email: currentUser.email,
            createdAt: new Date().toISOString()
        });
        
        await db.collection('users').doc(friendId).update({ friendRequests: theirRequests });
        
        document.getElementById('friendEmail').value = '';
        showToast('✅ Đã gửi lời mời kết bạn!', 'success');
        loadUsers();
        
    } catch (error) {
        console.error('Error:', error);
        alert('Lỗi khi gửi lời mời!');
    }
}

// Lắng nghe lời mời kết bạn
function listenForFriendRequests() {
    if (!currentUser) return;
    
    db.collection('users').doc(currentUser.uid).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            const friendRequests = data.friendRequests || [];
            
            if (friendRequests.length > 0) {
                const request = friendRequests[0];
                const accept = confirm(`🤝 ${request.name} muốn kết bạn!\n\nChấp nhận?`);
                
                if (accept) {
                    acceptFriendRequest(request);
                } else {
                    declineFriendRequest(request);
                }
            }
        }
    });
}

async function acceptFriendRequest(request) {
    try {
        const myDoc = await db.collection('users').doc(currentUser.uid).get();
        const myData = myDoc.data();
        const myFriends = myData.friends || [];
        if (!myFriends.includes(request.userId)) myFriends.push(request.userId);
        
        await db.collection('users').doc(currentUser.uid).update({
            friends: myFriends,
            friendRequests: []
        });
        
        const theirDoc = await db.collection('users').doc(request.userId).get();
        const theirData = theirDoc.data();
        const theirFriends = theirData.friends || [];
        if (!theirFriends.includes(currentUser.uid)) theirFriends.push(currentUser.uid);
        
        await db.collection('users').doc(request.userId).update({ friends: theirFriends });
        
        showToast('✅ Đã kết bạn!', 'success');
        loadUsers();
    } catch (error) {}
}

async function declineFriendRequest(request) {
    try {
        const myDoc = await db.collection('users').doc(currentUser.uid).get();
        const myData = myDoc.data();
        const friendRequests = myData.friendRequests || [];
        const updated = friendRequests.filter(r => r.userId !== request.userId);
        await db.collection('users').doc(currentUser.uid).update({ friendRequests: updated });
    } catch (error) {}
}

// ============ LOAD USERS ============
async function loadUsers() {
    try {
        const snapshot = await db.collection('users').limit(50).get();
        const userGrid = document.getElementById('userGrid');
        
        if (!userGrid) return;
        
        userGrid.innerHTML = '';
        let users = [];
        
        snapshot.docs.forEach(doc => {
            const user = doc.data();
            if (doc.id === currentUser?.uid) return;
            users.push({ id: doc.id, ...user });
        });
        
        if (users.length === 0) {
            userGrid.innerHTML = '<p style="text-align:center;padding:40px;">Không có người dùng nào.</p>';
            return;
        }
        
        for (const user of users) {
            const isFriend = currentUser ? (user.friends || []).includes(currentUser.uid) : false;
            const hasPendingRequest = currentUser ? (user.friendRequests || []).some(r => r.userId === currentUser.uid) : false;
            
            const card = document.createElement('div');
            card.style.cssText = 'background:white;border-radius:10px;padding:20px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);';
            card.innerHTML = `
                <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}&background=6366f1&color=fff&size=80" style="border-radius:50%;margin-bottom:10px;">
                <h3>${user.name || 'User'}</h3>
                <p style="color:${user.isOnline ? '#10b981' : '#64748b'};">
                    ${user.isOnline ? '🟢 Online' : '⚫ Offline'}
                </p>
                <p style="font-size:0.8rem;color:#64748b;">${user.email}</p>
                ${!isFriend && !hasPendingRequest && currentUser ? 
                    `<button onclick="quickAddFriend('${user.id}')" style="background:#f59e0b;color:white;border:none;padding:8px 15px;border-radius:20px;cursor:pointer;margin-top:10px;">+ Kết Bạn</button>` : 
                    isFriend ? '<p style="color:#10b981;margin-top:10px;">✅ Bạn bè</p>' : 
                    hasPendingRequest ? '<p style="color:#f59e0b;margin-top:10px;">⏳ Đã gửi</p>' : ''}
            `;
            userGrid.appendChild(card);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function quickAddFriend(friendId) {
    if (!currentUser) return;
    
    try {
        const friendDoc = await db.collection('users').doc(friendId).get();
        const friendData = friendDoc.data();
        const myDoc = await db.collection('users').doc(currentUser.uid).get();
        const myData = myDoc.data();
        const myFriends = myData.friends || [];
        
        if (myFriends.includes(friendId)) { showToast('Đã là bạn bè!', 'error'); return; }
        
        const theirRequests = friendData.friendRequests || [];
        if (theirRequests.some(r => r.userId === currentUser.uid)) { showToast('Đã gửi!', 'error'); return; }
        
        theirRequests.push({
            userId: currentUser.uid,
            name: myData.name || currentUser.email,
            email: currentUser.email,
            createdAt: new Date().toISOString()
        });
        
        await db.collection('users').doc(friendId).update({ friendRequests: theirRequests });
        showToast('✅ Đã gửi lời mời!', 'success');
        loadUsers();
    } catch (error) {}
}
