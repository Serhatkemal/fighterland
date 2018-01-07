var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});




var clientList = [];
var roomList = [];
var bulletList = [];
var roundEnemyList = [];
var enemyList = [];
var levelExperienceList = [];

var Room = function (name, size, socketList, enemyList) {
    this.currentRound = 1;
    this.name = name;
    this.size = size;
    this.socketList = socketList;
    this.enemyList = enemyList;
};

var Player = function (playerId) {
    this.playerId = playerId;
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.health = 20;
    this.maxHealth = 20;
    this.fireRate = 1000;  // player fireRate 1 shot per fireRate
    this.nextFire = 0;
    this.alive = true;
    this.SPEED = 100; // player speed pixels/second
    this.bullet = bulletList[0];
    this.experience = 0;
    this.level = 1;
};

var Enemy = function (id, x, y, health, maxHealth, SPEED, damage, enemyLevel) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this.health = health;
    this.maxHealth = maxHealth;
    this.alive = true;
    this.SPEED = SPEED;
    this.enemyLevel = enemyLevel;
    this.damage = damage;
    this.attackFrequency = 1000; //Attack frequency milliseconds
    this.nextAttack = 1;
};

var Bullet = function (name, damage, level) {
    this.name = name;
    this.damage = damage;
    this.level = level;
};


Enemy.prototype.attack = function (player) {
    if(this.nextAttack == 1){
        this.nextAttack = 0;
        setTimeout(this.resetNextAttack, this.attackFrequency, this);

        player.health -= this.damage;
        if (player.health <= 0) {
            player.alive = false;
            return true;
        }
        return false;
    } else {
        return false;
    }

};

Enemy.prototype.resetNextAttack = function (enemy) {
    if(enemy.nextAttack == 0){
        enemy.nextAttack = 1;
    }
};

Room.prototype.initialize = function () {
    createEnemyList(this);
};

Room.prototype.addSocketPlayer = function (socket) {
    console.log("user joining the room: " + this.name);
    this.socketList.push(socket);
};

Room.prototype.removeSocketPlayer = function (socket) {
    console.log("user has left the room: " + this.name);
    const index = this.socketList.indexOf(socket);
    this.socketList.splice(index, 1);
};

Room.prototype.getAllPlayers = function () {
    var playerList = [];
    for (var i = 0; i < this.socketList.length; i++) {
        playerList.push(this.socketList[i].player);
    }
    return playerList;
};

Room.prototype.getInfo = function () {
    return {name : this.name, playerSize: this.socketList.length};
};

Room.prototype.getAllEnemies = function () {
    var enemyList = [];
    for (var i = 0; i < this.enemyList.length; i++) {
        enemyList.push(this.enemyList[i]);
    }
    return enemyList;
};

Room.prototype.nextRound = function () {
    this.currentRound++;
    this.initialize();
};

Player.prototype.increaseExperience = function () {
    this.experience += this.bullet.damage;
    if (this.experience >= levelExperienceList[this.level - 1]) {
        this.experience = 0;
        this.level++;
        return true;
    }
    return false;
};

Player.prototype.attack = function (enemy) {
    enemy.health -= this.bullet.damage;
    if (enemy.health <= 0) {
        enemy.alive = false;
        return true;
    }
    return false;
};

Player.prototype.increasePower = function (powerUp) {
    if (powerUp == "health") {
        this.health += 5;
    } else if (powerUp == "weapon") {
        this.bullet = bulletList[this.bullet.level];
    } else if (powerUp == "moveSpeed") {
        this.SPEED += (this.SPEED * 10) / 100;
    } else if (powerUp == "fireSpeed") {
        this.fireRate -= (this.fireRate * 10) / 100;
    } else {
        //Do nothing
    }
};


initializeRoomList();//Create Server Rooms
initializeBulletList();//Create Bullets
initializeRoundEnemyList();//Create Round enemy info
initializeLevelExperienceList();//Create experience to next levels

io.on('connection', function (socket) {

    socket.on('roomList', function () {
        socket.emit('roomList', getRoomInfo());
    });

    socket.on('joinRoom', function (name) {
        var selectedRoom;
        for (var i = 0; i < roomList.length; i++) {
            if (roomList[i].name == name) {
                selectedRoom = roomList[i];
            }
        }

        var numClients = selectedRoom.socketList.length;

        if (numClients === 0) {
            socket.join(name);
            selectedRoom.addSocketPlayer(socket);
            socket.room = selectedRoom.name;

            //First player in room so initialize room
            selectedRoom.initialize();
            socket.emit('isHost', name);

            var player = createSocketPlayer(socket);
            socket.emit('startGame', player);
        }
        else if (numClients <= 3) {
            //io.sockets. in (name).emit('join', name);
            socket.join(name);
            selectedRoom.addSocketPlayer(socket);
            socket.room = selectedRoom.name;

            var player = createSocketPlayer(socket);
            socket.emit('startGame', player);
        }
        else {
            socket.emit('full', name);
        }
    });

    socket.on('playerReady', function () {

        //Send current player info to other players
        socket.to(socket.room).emit('newPlayer', socket.player);

        //Send room info to current player
        socket.emit('roomList', getRoomInfo());
        sendCurrentRoundInfo(socket.room);
    });

    socket.on('playerMove', function (playerPosition) {
        socket.player.x = playerPosition.x;
        socket.player.y = playerPosition.y;
        socket.player.rotation = playerPosition.rotation;
        socket.to(socket.room).emit('playerMove', {playerPosition: playerPosition, playerId: socket.id});
    });

    socket.on('playerFire', function (positionData) {
        socket.to(socket.room).emit('playerFire', {positionData: positionData, playerId: socket.id});
    });

    socket.on('playerHitEnemy', function (enemyId) {
        var playerRoom = getRoomByName(socket.room);
        var damagedEnemy;
        for (var i = 0; i < playerRoom.enemyList.length; i++) {
            if (playerRoom.enemyList[i].id == enemyId) {
                damagedEnemy = playerRoom.enemyList[i];
                var isLevelUp = socket.player.increaseExperience();  //Increase Player Experience
                if (isLevelUp) {
                    socket.emit('playerLevelUp', '');
                }
                var destroyed = socket.player.attack(damagedEnemy);
                if (destroyed) {
                    if (playerRoom.enemyList.length <= 1) {
                        sendNextRoundInfo(socket.room);
                    } else {
                        io.in(socket.room).emit('enemyDestroyed', playerRoom.enemyList[i]);
                    }
                    playerRoom.enemyList = playerRoom.enemyList.filter(enemy => enemy.id != enemyId
                );
                } else {
                    io.in(socket.room).emit('enemyDamaged', damagedEnemy);
                }
            }
        }
    });

    socket.on('playerLevelUp', function (powerUp) {
        socket.player.increasePower(powerUp);
        updateRoomPlayers(socket.room);
        socket.player.experience = 0;
    });


    socket.on('enemyMove', function (enemy) {
        var playerRoom = getRoomByName(socket.room);
        for (var i = 0; i < playerRoom.enemyList.length; i++) {
            if (playerRoom.enemyList[i].id == enemy.id) {
                playerRoom.enemyList[i].x = enemy.x;
                playerRoom.enemyList[i].y = enemy.y;
                playerRoom.enemyList[i].rotation = enemy.rotation;
            }
        }
        socket.to(socket.room).emit('enemyMove', enemy);
    });

    socket.on('enemyKilled', function (id) {
        var playerRoom = getRoomByName(socket.room);
        playerRoom.enemyList = playerRoom.enemyList.filter(enemy => enemy.id != id
    )
        ;
        if (playerRoom.enemyList.length <= 0) {
            sendNextRoundInfo(socket.room);
        }
    });

    socket.on('enemyHitPlayer', function (enemyId) {
        var playerRoom = getRoomByName(socket.room);
        var enemy;
        for (var i = 0; i < playerRoom.enemyList.length; i++) {
            if (playerRoom.enemyList[i].id == enemyId) {
                enemy = playerRoom.enemyList[i];
                var destroyed = enemy.attack(socket.player);
                if (destroyed) {
                    io.in(socket.room).emit('playerDestroyed', socket.player.playerId);
                } else {
                    updateRoomPlayers(socket.room);
                }
            }
        }
    });

    // TODO : Host lefts the game !!!
    socket.on('disconnect', function () {
        var i = clientList.indexOf(socket);
        clientList.splice(i, 1);

        for (var i = 0; i < roomList.length; i++) {
            if (roomList[i].name == socket.room) {
                roomList[i].removeSocketPlayer(socket);

                //All players left reset room
                if (roomList[i].getAllPlayers().length <= 0) {
                    roomList[i] = new Room("Room " + (i + 1), 0, [], []);
                }
            }
        }

        socket.to(socket.room).emit('disconnectedPlayer', socket.id);
    });

    console.log(clientList);

});

function createSocketPlayer(socket) {
    socket.player = new Player(socket.id);
    clientList.push(socket.id);
    return socket.player;
}

function updateRoomPlayers(roomName) {
    var room = getRoomByName(roomName);
    var roomPlayers = room.getAllPlayers();
    io.in(roomName).emit('updateRoomPlayers', roomPlayers);
}

function sendCurrentRoundInfo(roomName) {
    var room = getRoomByName(roomName);
    var currentRound = room.currentRound;
    io.in(roomName).emit('currentRound', {
        currentRound: currentRound,
        enemyList: room.enemyList,
        friends: room.getAllPlayers()
    });
}

function sendNextRoundInfo(roomName) {
    var room = getRoomByName(roomName);
    room.nextRound();
    io.in(roomName).emit('currentRound', {
        currentRound: room.currentRound,
        enemyList: room.enemyList,
        friends: room.getAllPlayers()
    });
}

http.listen(PORT, function () {
    console.log('listening on *: ' + PORT);
});

function guid() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }

    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}

function getRoomInfo() {
    var roomInfoList = [];
    for (var i = 0; i < roomList.length; i++) {
        roomInfoList.push(roomList[i].getInfo());
    }
    return roomInfoList;
};

function getRoomByName(roomName) {
    for (var i = 0; i < roomList.length; i++) {
        if (roomName == roomList[i].name) {
            return roomList[i];
        }
    }
}

function initializeRoomList() {
    roomList[0] = new Room("Room 1", 0, [], []);
    roomList[1] = new Room("Room 2", 0, [], []);
    roomList[2] = new Room("Room 3", 0, [], []);
    roomList[3] = new Room("Room 4", 0, [], []);
    roomList[4] = new Room("Room 5", 0, [], []);
    roomList[5] = new Room("Room 6", 0, [], []);
    roomList[6] = new Room("Room 7", 0, [], []);
    roomList[7] = new Room("Room 8", 0, [], []);
    roomList[8] = new Room("Room 9", 0, [], []);
    roomList[9] = new Room("Room 10", 0, [], []);
    roomList[10] = new Room("Room 11", 0, [], []);
    roomList[11] = new Room("Room 12", 0, [], []);
    roomList[12] = new Room("Room 13", 0, [], []);
}

function initializeBulletList() {
    bulletList[0] = new Bullet("Single I", 1, 1);
    bulletList[1] = new Bullet("Single II", 2, 2);
    bulletList[2] = new Bullet("Single III", 3, 3);
    bulletList[3] = new Bullet("Bold I", 5, 4);
    bulletList[4] = new Bullet("Bold II", 8, 5);
    bulletList[5] = new Bullet("Bold III", 13, 6);
    bulletList[6] = new Bullet("Missile I", 21, 7);
    bulletList[7] = new Bullet("Missile II", 34, 8);
    bulletList[8] = new Bullet("Missile III", 55, 9);
    bulletList[9] = new Bullet("Beam I", 89, 10);
    bulletList[10] = new Bullet("Beam II", 144, 11);
    bulletList[11] = new Bullet("Beam III", 233, 12);
    bulletList[12] = new Bullet("Ultra Beam I", 377, 13);
    bulletList[13] = new Bullet("Ultra Beam II", 610, 14);
    bulletList[14] = new Bullet("Ultra Beam III", 987, 15);
    bulletList[15] = new Bullet("Hyper Beam I", 1597, 16);
    bulletList[16] = new Bullet("Hyper Beam II", 2584, 17);
    bulletList[17] = new Bullet("Hyper Beam III", 4181, 18);
    bulletList[18] = new Bullet("Mega Beam I", 6765, 19);
    bulletList[19] = new Bullet("Mega Beam II", 10946, 20);
    bulletList[20] = new Bullet("Mega Beam III", 17711, 21);
    bulletList[21] = new Bullet("Nova I", 28657, 22);
    bulletList[22] = new Bullet("Nova II", 46368, 23);
    bulletList[23] = new Bullet("Nova III", 75025, 24);
    bulletList[24] = new Bullet("Cosmos I", 121393, 25);
    bulletList[25] = new Bullet("Cosmos II", 196418, 26);
    bulletList[26] = new Bullet("Cosmos III", 317811, 27);
    bulletList[27] = new Bullet("Ionic I", 514229, 28);
    bulletList[28] = new Bullet("Ionic II", 832040, 29);
    bulletList[29] = new Bullet("Ionic III", 1346269, 30);
    bulletList[30] = new Bullet("Gas I", 2178309, 31);
    bulletList[31] = new Bullet("Gas II", 3524578, 32);
    bulletList[32] = new Bullet("Gas III", 5702887, 33);
    bulletList[33] = new Bullet("Crystal-I", 9227465, 34);
    bulletList[34] = new Bullet("Crystal-II", 14930352, 35);
    bulletList[35] = new Bullet("Sulfur", 24157817, 36);
    bulletList[36] = new Bullet("Xenon", 39088169, 37);
    bulletList[37] = new Bullet("Flame", 63245986, 38);
    bulletList[38] = new Bullet("Super Nova I", 102334155, 39);
    bulletList[39] = new Bullet("Super Nova II", 165580141, 40);
};

function createEnemyList(room) {
    var roundEnemyInfo = roundEnemyList[room.currentRound - 1];
    var totalEnemy = 0;
    for(var i = 0; i < roundEnemyInfo.length; i++){
        for(var j = 0; j < roundEnemyInfo[i]; j++){
            room.enemyList[totalEnemy] = createEnemy(i + 1);
            totalEnemy++;
        }
    }
};

function initializeRoundEnemyList(){
    //-----------enemy----1---2---3---4---5*--6---7---8---9--10*--11--12--13--14--15*--16--17--18--19
    roundEnemyList[0] =  [20, 20, 0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,   0,  0,  0,  0];
    roundEnemyList[1] =  [15, 20, 20, 0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,   0,  0,  0,  0];
    roundEnemyList[2] =  [0,  15, 20, 20, 0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,   0,  0,  0,  0];
    roundEnemyList[3] =  [0,  0,  15, 20, 5,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,   0,  0,  0,  0];
    roundEnemyList[4] =  [0,  0,  0,  15,10, 20,  0,  0,  0,  0,  0,  0,  0,  0,  0,   0,  0,  0,  0];
    roundEnemyList[5] =  [0,  0,  0,  0,  5, 15, 20,  0,  0,  0,  0,  0,  0,  0,  0,   0,  0,  0,  0];
    roundEnemyList[6] =  [0,  0,  0,  0,  0,  0, 15, 20, 20,  0,  0,  0,  0,  0,  0,   0,  0,  0,  0];
    roundEnemyList[7] =  [0,  0,  0,  0,  0,  0,  0, 15, 15,  5,  0,  0,  0,  0,  0,   0,  0,  0,  0];
    roundEnemyList[8] =  [0,  0,  0,  0,  0,  0,  0,  0, 15,  10,20,  0,  0,  0,  0,   0,  0,  0,  0];
    roundEnemyList[9] =  [0,  0,  0,  0,  0,  0,  0,  0,  0,  5, 20, 20,  0,  0,  0,   0,  0,  0,  0];
    roundEnemyList[10] = [0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 15, 15, 20,  0,  0,   0,  0,  0,  0];
    roundEnemyList[11] = [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 15, 15, 20,  0,   0,  0,  0,  0];
    roundEnemyList[12] = [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 15, 20,  5,   0,  0,  0,  0];
    roundEnemyList[13] = [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 15,  10, 20,  0,  0,  0];
    roundEnemyList[14] = [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  5,  15, 20,  0,  0];
    roundEnemyList[15] = [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  15, 20, 20,  0];
    roundEnemyList[16] = [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  15, 20, 20];
}

function initializeLevelExperienceList() {
    levelExperienceList[0] = 10;
    levelExperienceList[1] = 30;
    levelExperienceList[2] = 60;
    levelExperienceList[3] = 90;
    levelExperienceList[4] = 135;
    levelExperienceList[5] = 195;
    levelExperienceList[6] = 300;
    levelExperienceList[7] = 450;
    levelExperienceList[8] = 650;
    levelExperienceList[9] = 1300;
    levelExperienceList[10] = 1950;
}

function createEnemy(level){
    switch (level) {
        case 1:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 3, 3, 30, 1, 1);
        case 2:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 5, 5, 40, 2, 2);
        case 3:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 8, 8, 50, 3, 3);
        case 4:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 12, 12, 60, 5, 4);
        case 5:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 250, 250, 60, 50, 5);  // BOSS
        case 6:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 20, 20, 60, 8, 6);
        case 7:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 30, 30, 60, 15, 7);
        case 8:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 50, 50, 70, 25, 8);
        case 9:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 80, 80, 80, 40, 9);
        case 10:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 1200, 1200, 70, 200, 10);   // BOSS
        case 11:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 150, 150, 90, 100, 11);
        case 12:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 250, 250, 100, 130, 12);
        case 13:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 400, 400, 110, 165, 13);
        case 14:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 600, 600, 120, 200, 14);
        case 15:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 5000, 5000, 90, 800, 15);  //BOSS
        case 16:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 1000, 1000, 120, 400, 16);
        case 17:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 1500, 1500, 140, 600, 17);
        case 18:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 2500, 2500, 140, 800, 18);
        case 19:
            return new Enemy(guid(), createRandomEnemyPosition().x, createRandomEnemyPosition().y, 3500, 3500, 150, 1000, 19);
    }
}

function createRandomEnemyPosition() {
    var x = Math.floor(Math.random() * 2000);
    var y = Math.floor(Math.random() * 2000);

    var randomDirection = Math.floor(Math.random() * 2);
    if (x > y) {
        y = randomDirection == 1 ? -1000 : 1000;
    } else {
        x = randomDirection == 1 ? -1000 : 1000;
    }
    return {x: x, y: y};
}
