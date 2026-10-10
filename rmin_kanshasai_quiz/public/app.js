const socket = io();
const $ = id => document.getElementById(id);
let playerId = null, isHost = false, joined = false, currentState = null, sampleQuestions = [];
const imageNames = ["choice-1.png","choice-2.png","choice-3.png","choice-4.png"];
function toast(text){const el=$("toast");el.textContent=text;el.style.display="block";setTimeout(()=>el.style.display="none",2800)}
function showView(view){document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$("playerView").hidden=view!=="player";$("hostView").hidden=view!=="host"}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>showView(b.dataset.view));
$("joinBtn").onclick=()=>socket.emit("join",{name:$("playerName").value,roomCode:$("roomCode").value});
$("hostLoginBtn").onclick=()=>socket.emit("host-auth",$("hostPin").value);
$("copyRoom").onclick=()=>navigator.clipboard?.writeText($("hostRoomCode").textContent).then(()=>toast("参加コードをコピーしました"));
$("startBtn").onclick=()=>socket.emit("start-question",{text:$("qText").value,choices:[0,1,2,3].map(i=>$("c"+i).value),correct:Number($("correct").value),seconds:Number($("seconds").value),points:Number($("points").value)});
$("lockBtn").onclick=()=>socket.emit("lock-answers");
$("revealBtn").onclick=()=>socket.emit("reveal");
$("lobbyBtn").onclick=()=>socket.emit("back-to-lobby");
$("resetBtn").onclick=()=>{if(confirm("全員の得点を0にしますか？"))socket.emit("reset-scores")};
$("buzzBtn").onclick=()=>socket.emit("buzz");
$("demoBtn").onclick=()=>{if(!sampleQuestions.length){toast("司会者としてログインしてください");return}const q=sampleQuestions[Math.min(currentState?.questionNumber||0,sampleQuestions.length-1)];$("qText").value=q.text;q.choices.forEach((c,i)=>$("c"+i).value=c);$("correct").value=q.correct;$("points").value=q.points||10};
socket.on("joined",data=>{playerId=data.id;joined=true;$("joinBox").hidden=true;$("playerGame").hidden=false;toast("参加しました！")});
socket.on("host-auth-ok",data=>{isHost=true;$("hostLogin").hidden=true;$("hostGame").hidden=false;$("hostRoomCode").textContent=data.roomCode;toast("司会者ログインしました")});
socket.on("host-state",data=>{sampleQuestions=data.demoQuestions||[]});
socket.on("notice",data=>toast(data.text));
socket.on("answer-received",()=>toast("回答を受け付けました"));
socket.on("state",s=>{currentState=s;render(s)});
function render(s){
 $("playerStatus").textContent=({lobby:"司会者の開始をお待ちください",question:"回答受付中！",locked:"回答締切！正解発表をお待ちください",reveal:"正解発表"})[s.phase]||"待機中";
 $("playerQuestion").textContent=s.question?.text||"まもなくクイズが始まります";
 $("playerClock").textContent=s.phase==="question"?s.secondsLeft:"—";
 $("hostStatus").textContent=({lobby:"待機中",question:"回答受付中",locked:"回答締切",reveal:"正解発表済み"})[s.phase]||"待機中";
 $("hostQuestion").textContent=s.question?.text||"問題はまだありません";
 $("hostClock").textContent=s.phase==="question"?s.secondsLeft:"—";
 $("firstBuzz").textContent=s.firstBuzz?.name||"なし";
 $("buzzBtn").disabled=!joined||s.phase!=="question"||Boolean(s.players.find(p=>p.id===playerId)?.buzzed);
 const choices=$("playerChoices");choices.innerHTML="";
 (s.question?.choices||[]).forEach((c,i)=>{const b=document.createElement("button");b.className="choice";b.disabled=!joined||s.phase!=="question"||Boolean(s.answers?.[playerId]);const img=document.createElement("img");img.src="/assets/"+imageNames[i];img.alt=["①","②","③","④"][i];const span=document.createElement("span");span.textContent=c;b.append(img,span);b.onclick=()=>socket.emit("answer",i);choices.append(b)});
 const stamp=$("resultStamp");
 if(s.phase==="reveal"&&s.answers?.[playerId]){stamp.hidden=false;stamp.src="/assets/"+(s.answers[playerId].correct?"correct.png":"incorrect.png")}
 else if(s.phase==="question"&&s.answers?.[playerId]){stamp.hidden=false;stamp.src="/assets/please-wait.png"}
 else {stamp.hidden=true}
 const me=s.players.find(p=>p.id===playerId);$("myScore").textContent=(me?.score||0)+" pt";
 fillList("playerRanking",s.leaderboard||[],true);fillList("hostRanking",s.leaderboard||[],true);
 $("hostPlayers").innerHTML="";(s.players||[]).forEach(p=>{const li=document.createElement("li");li.textContent=`${p.name} — ${p.connected?"接続中":"切断"}${p.buzzed?" / 早押し済み":""}`;$("hostPlayers").append(li)});
}
function fillList(id,items){const el=$(id);el.innerHTML="";items.forEach(p=>{const li=document.createElement("li");li.textContent=`${p.name} — ${p.score} pt`;el.append(li)})}
