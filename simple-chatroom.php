<?php

function mysql_escape_mimic($inp) {
  if(is_array($inp))
    return array_map(__METHOD__, $inp);

  if(!empty($inp) && is_string($inp)) {
    return str_replace(array('\\', "\0", "\n", "\r", "'", '"', "\x1a"), array('\\\\', '\\0', '\\n', '\\r', "\\'", '\\"', '\\Z'), $inp);
  }

  return $inp;
} 

$servername = 'localhost';
$username = '';
$password = '';
$dbname = 'chatroom';

$conn = new mysqli($servername, $username, $password, $dbname);

if ($conn->connect_error) {
  die("Connection failed: " . $conn->connect_error);
}

if ($_REQUEST['q'] != '') {
  $result = $conn->query("SELECT max(id) FROM messages");
  $row = $result->fetch_assoc();
  $id = $row['max(id)'];

  if ($_REQUEST['q'] == 'start') {
    $sql = "SELECT message, username FROM messages JOIN users ON users.id=messages.users_id ORDER BY messages.id DESC LIMIT 100";
  } else {
    $sql = "SELECT message, username FROM messages JOIN users ON users.id=messages.users_id WHERE messages.id > " . $_REQUEST['q'] . " ORDER BY messages.id DESC";
  }
  $result = $conn->query($sql);
  
  echo $id . ",";
  $buildHTML = '';
  if ($result->num_rows > 0) {
    while($row = $result->fetch_assoc()) {
      $buildHTML = "<span class='name'>" . $row['username'] . "</span>: " . $row['message'] . "<br />\n" . $buildHTML;
    }
  }
  echo $buildHTML;
  exit();
} 


$valid_username = FALSE;
if (isset($_COOKIE['username'])) {
  if (ctype_alpha($_COOKIE['username'])) {
    $sql = "SELECT * FROM users WHERE username='" . mysql_escape_mimic($_COOKIE['username']) . "'";
    $result = $conn->query($sql);
    if ($result->num_rows == 0) {
      $sql = "INSERT INTO users (username) values ('" . mysql_escape_mimic($_COOKIE['username']) . "')";
      if (!$conn->query($sql)) {
        echo "Error inserting new user.";
      } else {
        $valid_username = TRUE;
      }
    } else {
      $valid_username = TRUE;
    } 
  } else {
    echo "Only letters please.";
  }
}

if ($_SERVER["REQUEST_METHOD"] == "POST" && $_POST['msg'] != '' && $valid_username) {
  $sql = "INSERT INTO messages (message, users_id) values ('" . mysql_escape_mimic($_POST['msg']) . "', (SELECT id FROM users WHERE username = '" . mysql_escape_mimic($_COOKIE['username']) . "'))";
  if (!$conn->query($sql)) {
    echo "Error: " . $sql . "<br />" . $conn->error . "<br />";
  }
  exit();
}

?>
<html>
<head>
  <title>Collaborative Geocities Website</title>
<meta name="viewport" content="width=device-width, height=device-height,  initial-scale=1.0, user-scalable=no, user-scalable=0"/>
<style>
* {margin: 0; border 0;}
body, html {
  height: 100%;
  width: 100%;
  overflow: hidden; 
  background-color: #eee;
  font-family: Arial, Helvetica, sans-serif;
}
#chatbox {
  font-size: 1.5vmax;
  margin: 0 0 4vmax 0;
  padding: 0 0 0 0;
  position: absolute;
  top: 0;
  bottom: 0;
  width: 100%;
  overflow: auto;
  overflow-x: hidden;
}
#messagebox {
  width: 100%;
  background-color: #AAA;
  height: 3.5vmax;
  position: absolute;
  bottom: 0;
  font-size: 1.5vmax;
  padding: .5vmax;
  border: 0;
  border-top: 2px solid black;
}
.name {
  color: #448844;
  position: relative;
  padding-left: .5vmax;
}
.message {
  color: #333;
}
#logout {
  text-decoration: none;
  display: inline-block;
  font-size: 2vmax;
  color: white;
  background-color: #333;
  border: 0;
  padding: 1vmax 1vmax;
  cursor: pointer;
}
img {
  max-width: 200px;
  max-height: 200px;
}
</style>
</head>
<body>
<div id="chatbox">
</div>
<div >
  <form action="javascript:putMessage()" autocomplete="off">
    <input type="text" name="msg" placeholder="enter message..." id="messagebox" autocomplete="off" autofocus>
  </form>
</div>
<div style="top: 0px; right: 0px;position: absolute;">
  <input id="logout" type="button" value="logout" onclick="deleteCookie();" />
</div>
</body>
<script>
function getCookie(cname) {
  var name = cname + "=";
  var ca = document.cookie.split(';');
  for(var i = 0; i <ca.length; i++) {
    var c = ca[i];
    while (c.charAt(0)==' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) == 0) {
      return c.substring(name.length,c.length);
    }
  }
  return 0;
} 
function setCookie(cname, cvalue, exdays) {
  var d = new Date();
  d.setTime(d.getTime() + (exdays*24*60*60*1000));
  var expires = "expires="+ d.toUTCString();
  document.cookie = cname + "=" + cvalue + "; " + expires;
}
function checkCookie() {
  if (!getCookie('username')) {
    var username = 0;
    username = prompt("Enter username:", "")
    while (!/^[a-zA-Z]+$/.test(username)) {
      username = prompt("Enter username (letters only):", "")
    };
    if (username != "" && username != null) {
      setCookie("username", username, 365);
    }
  }
}
function deleteCookie () {
  document.cookie = "username=; expires=Thu, 01 Jan 1970 00:00:00 UTC"; 
  window.location = window.location.href;
}
function getMessages () {
  var xmlhttp = new XMLHttpRequest();
  xmlhttp.onreadystatechange = function() {
    if (this.readyState == 4 && this.status == 200) {
      var checkscroll = 0;
      if (objDiv.scrollHeight - objDiv.scrollTop === objDiv.clientHeight) {
        checkscroll = 1;
      }
      
      var splitIndex = this.responseText.indexOf(",");
      lastMsg = this.responseText.substr(0,splitIndex);
      var text = this.responseText.substr(splitIndex + 1);
      if (text != '') {
        var newcontent = document.createElement('div');
        newcontent.innerHTML = text;
        while (newcontent.firstChild) {
          document.getElementById("chatbox").appendChild(newcontent.firstChild);
        }
      }   
      if (checkscroll) {
        objDiv.scrollTop = objDiv.scrollHeight;
      }
    }
  }
  if (document.getElementById("chatbox").innerHTML == '') {
    xmlhttp.open("GET", "chatroom.php?q=start", true);
  } else {
    xmlhttp.open("GET", "chatroom.php?q=" + lastMsg, true);
  }
  xmlhttp.send();
}
function putMessage () {
  var inputObj = document.getElementById("messagebox");
  if (inputObj.value != '') {
    var xmlhttp = new XMLHttpRequest();
    xmlhttp.onreadystatechange = function() {}
    xmlhttp.open("POST", "chatroom.php", true)
    xmlhttp.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
    xmlhttp.send('msg=' + inputObj.value);
    inputObj.value = '';
  }
  objDiv.scrollTop = objDiv.scrollHeight;
}

var lastMsg = 1;
getMessages();
var objDiv = document.getElementById("chatbox");
setInterval(getMessages, 300);

checkCookie();

window.onbeforeunload = function () {
  return "did you want to leave or did someone make a redirect, lul"; 
}
window.onload = function () {
  document.getElementById("messagebox").focus();
  objDiv.scrollTop = objDiv.scrollHeight;
};
window.addEventListener("resize", function(e){
  objDiv.scrollTop = objDiv.scrollHeight;
});
window.addEventListener("orientationchange", function(e){
  objDiv.scrollTop = objDiv.scrollHeight;
});
</script>
</html>
