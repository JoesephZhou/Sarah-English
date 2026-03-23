import { useState, useEffect, useRef, useCallback } from "react";

const SARAH_PHOTO = process.env.PUBLIC_URL + "/sarah.jpg";

const SYSTEM_PROMPT = `You are "Sarah", a warm and friendly Canadian English tutor based in Toronto. You speak naturally and conversationally, like a real friend — not a formal teacher. You occasionally say "eh", mention Tim Hortons, hockey, poutine, and other Canadian cultural references naturally.

IMPORTANT: This is a SPOKEN conversation. Keep responses SHORT — 2-4 sentences max. No bullet points, no lists, just natural speech.

Your goals:
1. Have natural spoken conversations in Canadian English
2. Teach Canadian slang, phrasal verbs, idioms organically mid-conversation
3. Remember words the student has learned and quiz them naturally every 3-4 exchanges
4. Gently correct grammar mistakes once and move on
5. Be encouraging and fun!

ALWAYS respond in this EXACT JSON format:
{
  "message": "Your spoken reply (2-4 sentences, natural, no markdown)",
  "newWords": [
    { "word": "word or phrase", "definition": "short def", "example": "example sentence", "type": "slang|phrasal_verb|idiom|cultural" }
  ],
  "quizWord": null,
  "quizResult": null,
  "needsReview": false,
  "reviewWord": null,
  "teachingNote": "one short Chinese note if helpful, or null",
  "emotion": "neutral|happy|excited|encouraging|thinking"
}
Only include newWords you actually introduced in THIS message. emotion drives Sarah's facial expression.`;

const TOPICS = [
  { title: "Weekend Plans", emoji: "🍁", hint: "What Canadians do on weekends" },
  { title: "Hockey Night", emoji: "🏒", hint: "Canada's national passion" },
  { title: "Tim Hortons Run", emoji: "☕", hint: "A true Canadian experience" },
  { title: "Toronto Life", emoji: "🏙️", hint: "Living in Canada's biggest city" },
  { title: "Winter Survival", emoji: "❄️", hint: "How Canadians handle winter" },
  { title: "Canadian Food", emoji: "🍟", hint: "Poutine, butter tarts & more" },
  { title: "Job Interview", emoji: "💼", hint: "Professional Canadian English" },
  { title: "At the Mall", emoji: "🛍️", hint: "Shopping small talk" },
  { title: "Netflix & Chill", emoji: "📺", hint: "Pop culture conversations" },
  { title: "Road Trip", emoji: "🚗", hint: "Travelling across Canada" },
];

const typeColor = { slang:"#FF6B6B", phrasal_verb:"#4ECDC4", idiom:"#FFE66D", cultural:"#A8E6CF" };

const speak = (text, onEnd) => {
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "en-CA"; utt.rate = 0.92; utt.pitch = 1.1;
  const voices = window.speechSynthesis.getVoices();
  const v = voices.find(v => v.lang.startsWith("en") && (v.name.includes("Samantha") || v.name.includes("Karen") || v.name.includes("Fiona")));
  if (v) utt.voice = v;
  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
};

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("sarahApiKey") || "");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [screen, setScreen] = useState("home");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [emotion, setEmotion] = useState("neutral");
  const [mouthOpen, setMouthOpen] = useState(false);
  const [flashcards, setFlashcards] = useState(() => { try { return JSON.parse(localStorage.getItem("sarahCards") || "[]"); } catch { return []; } });
  const [reviewList, setReviewList] = useState(() => { try { return JSON.parse(localStorage.getItem("sarahReview") || "[]"); } catch { return []; } });
  const [currentTopic, setCurrentTopic] = useState(null);
  const [flippedCard, setFlippedCard] = useState(null);
  const [filterMode, setFilterMode] = useState("all");
  const [conversationHistory, setConversationHistory] = useState([]);
  const [studentProfile, setStudentProfile] = useState(() => { try { return JSON.parse(localStorage.getItem("sarahProfile") || '{"level":"beginner","exchanges":0}'); } catch { return {level:"beginner",exchanges:0}; } });
  const [quizActive, setQuizActive] = useState(null);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [streak, setStreak] = useState(() => { try { return JSON.parse(localStorage.getItem("sarahStreak") || '{"days":0,"lastDate":""}'); } catch { return {days:0,lastDate:""}; } });
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const streamRef = useRef(null);
  const holdingRef = useRef(false);
  const liveTextRef = useRef("");
  const mouthIntervalRef = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);
  useEffect(() => { liveTextRef.current = liveText; }, [liveText]);
  useEffect(() => { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices(); }, []);

  useEffect(() => {
    const today = new Date().toDateString();
    if (streak.lastDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      const newDays = streak.lastDate === yesterday ? streak.days + 1 : 1;
      const newStreak = { days: newDays, lastDate: today };
      setStreak(newStreak);
      localStorage.setItem("sarahStreak", JSON.stringify(newStreak));
    }
  }, []);

  const startMouthAnim = () => {
    clearInterval(mouthIntervalRef.current);
    mouthIntervalRef.current = setInterval(() => { setMouthOpen(p => !p); }, 180);
  };
  const stopMouthAnim = () => { clearInterval(mouthIntervalRef.current); setMouthOpen(false); };

  const saveKey = () => {
    const k = apiKeyInput.trim();
    if (!k.startsWith("sk-ant-")) { alert("需要 Anthropic API Key (sk-ant-...)"); return; }
    localStorage.setItem("sarahApiKey", k);
    setApiKey(k);
  };

  const addNewWords = useCallback((words) => {
    setFlashcards(prev => {
      const existing = prev.map(f => f.word.toLowerCase());
      const newOnes = words.filter(w => !existing.includes(w.word.toLowerCase()));
      if (!newOnes.length) return prev;
      const updated = [...prev, ...newOnes.map(w => ({ ...w, learned: new Date().toISOString(), needsReview: false }))];
      localStorage.setItem("sarahCards", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const callSarah = async (history, note, key) => {
    const last = history[history.length - 1];
    const withNote = [...history.slice(0, -1), { role: last.role, content: last.content + (note ? "\n" + note : "") }];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-api-key": key, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" },
      body: JSON.stringify({ model:"claude-opus-4-5", max_tokens:600, system:SYSTEM_PROMPT, messages:withNote })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.content[0].text;
  };

  const processResponse = useCallback((text, history, currentQuiz, profile) => {
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = { message: text, newWords:[], emotion:"neutral" }; }
    setMessages(prev => [...prev, { role:"sarah", ...parsed }]);
    setConversationHistory([...history, { role:"assistant", content:text }]);
    if (parsed.emotion) setEmotion(parsed.emotion);
    if (parsed.newWords?.length) addNewWords(parsed.newWords);
    if (parsed.needsReview && parsed.reviewWord) {
      setReviewList(prev => {
        if (prev.find(r => r.word === parsed.reviewWord)) return prev;
        const updated = [...prev, { word: parsed.reviewWord, needsReview: true }];
        localStorage.setItem("sarahReview", JSON.stringify(updated));
        return updated;
      });
      setFlashcards(prev => { const u = prev.map(f => f.word === parsed.reviewWord ? {...f, needsReview:true} : f); localStorage.setItem("sarahCards", JSON.stringify(u)); return u; });
    }
    if (parsed.quizResult === "correct" && currentQuiz) {
      setReviewList(prev => { const u = prev.filter(r => r.word !== currentQuiz); localStorage.setItem("sarahReview", JSON.stringify(u)); return u; });
      setFlashcards(prev => { const u = prev.map(f => f.word === currentQuiz ? {...f,needsReview:false} : f); localStorage.setItem("sarahCards", JSON.stringify(u)); return u; });
    }
    if (parsed.quizWord) setQuizActive(parsed.quizWord);
    else if (parsed.quizResult) setQuizActive(null);
    setSpeaking(true);
    startMouthAnim();
    speak(parsed.message, () => { setSpeaking(false); stopMouthAnim(); setEmotion("neutral"); });
    const np = { ...profile, exchanges: profile.exchanges + 1 };
    setStudentProfile(np); localStorage.setItem("sarahProfile", JSON.stringify(np));
  }, [addNewWords]);

  const startChat = async (topic) => {
    setCurrentTopic(topic); setMessages([]); setConversationHistory([]); setQuizActive(null);
    setScreen("chat"); setLoading(true); window.speechSynthesis.cancel();
    const fc = JSON.parse(localStorage.getItem("sarahCards") || "[]");
    const rl = JSON.parse(localStorage.getItem("sarahReview") || "[]");
    const sp = JSON.parse(localStorage.getItem("sarahProfile") || '{"level":"beginner","exchanges":0}');
    const init = `Start a spoken conversation about "${topic.title}" (${topic.hint}). Level: ${sp.level}, exchanges: ${sp.exchanges}. Learned: ${fc.map(f=>f.word).join(", ")||"none"}. Review: ${rl.map(r=>r.word).join(", ")||"none"}. Keep it short and natural for speaking.`;
    const history = [{ role:"user", content:init }];
    try {
      const text = await callSarah(history, "", apiKey);
      processResponse(text, history, null, sp);
    } catch(e) {
      const fallback = { role:"sarah", message:"Hey! I'm Sarah, your Canadian English tutor. Ready to chat, eh? 🍁", emotion:"happy" };
      setMessages([fallback]); setSpeaking(true); startMouthAnim();
      speak(fallback.message, () => { setSpeaking(false); stopMouthAnim(); });
    }
    setLoading(false);
  };

  const startVol = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      audioCtxRef.current.createMediaStreamSource(stream).connect(analyserRef.current);
      const data = new Uint8Array(analyserRef.current.frequencyBinCount);
      const tick = () => { if (!holdingRef.current) return; analyserRef.current.getByteFrequencyData(data); setVolumeLevel(Math.min(data.reduce((a,b)=>a+b,0)/data.length/40,1)); animFrameRef.current = requestAnimationFrame(tick); };
      tick();
    } catch(e) {}
  };
  const stopVol = () => { cancelAnimationFrame(animFrameRef.current); streamRef.current?.getTracks().forEach(t=>t.stop()); try{audioCtxRef.current?.close();}catch{}; setVolumeLevel(0); };

  const startRecording = async () => {
    if (loading || speaking || holdingRef.current) return;
    window.speechSynthesis.cancel(); setSpeaking(false); stopMouthAnim();
    holdingRef.current = true; setRecording(true); setLiveText(""); liveTextRef.current = "";
    await startVol();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("请用 Safari，才能使用语音识别"); holdingRef.current=false; setRecording(false); return; }
    const r = new SR(); r.lang="en-US"; r.continuous=true; r.interimResults=true;
    recognitionRef.current = r;
    r.onresult = (e) => { let int="",fin=""; for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)fin+=e.results[i][0].transcript;else int+=e.results[i][0].transcript;} const t=fin||int; setLiveText(t); liveTextRef.current=t; };
    r.onerror = ()=>{};
    try { r.start(); } catch {}
  };

  const stopRecording = async () => {
    if (!holdingRef.current) return;
    holdingRef.current = false; setRecording(false); stopVol();
    try { recognitionRef.current?.stop(); } catch {}
    const final = liveTextRef.current.trim(); setLiveText(""); liveTextRef.current = "";
    if (!final) return;
    setMessages(prev => [...prev, { role:"user", message:final }]);
    setLoading(true);
    const fc = JSON.parse(localStorage.getItem("sarahCards")||"[]");
    const rl = JSON.parse(localStorage.getItem("sarahReview")||"[]");
    const sp = JSON.parse(localStorage.getItem("sarahProfile")||'{"level":"beginner","exchanges":0}');
    const note = `[exchanges=${sp.exchanges+1}, learned:${fc.map(f=>f.word).join(",")||"none"}, review:${rl.map(r=>r.word).join(",")||"none"}]`;
    const newHist = [...conversationHistory, { role:"user", content:final }];
    try {
      const text = await callSarah(newHist, note, apiKey);
      processResponse(text, newHist, quizActive, sp);
    } catch(e) {
      setMessages(prev => [...prev, { role:"sarah", message:"Sorry, connection issue! Try again, eh? 😅" }]);
    }
    setLoading(false);
  };

  const handleStart = e => { e.preventDefault(); startRecording(); };
  const handleEnd = e => { e.preventDefault(); stopRecording(); };

  const displayCards = filterMode === "review" ? flashcards.filter(f=>f.needsReview) : flashcards;
  const todayTopic = TOPICS[new Date().getDay() % TOPICS.length];

  const emotionFilter = {
    neutral: "none",
    happy: "brightness(1.05) saturate(1.1)",
    excited: "brightness(1.1) saturate(1.2)",
    encouraging: "brightness(1.08)",
    thinking: "brightness(0.95) saturate(0.9)"
  };

  if (!apiKey) return (
    <div style={{minHeight:"100dvh",background:"linear-gradient(160deg,#0a0e1a,#0d1f3c)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 24px",fontFamily:"Georgia,serif",color:"#e8e0d0"}}>
      <div style={{width:"90px",height:"90px",borderRadius:"50%",overflow:"hidden",marginBottom:"16px",border:"3px solid #c8102e",boxShadow:"0 0 30px rgba(200,16,46,0.4)"}}>
        <img src={SARAH_PHOTO} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top"}} alt="Sarah"/>
      </div>
      <div style={{fontSize:"26px",fontWeight:"700",marginBottom:"4px"}}>Sarah</div>
      <div style={{fontSize:"12px",color:"#7a8a9a",marginBottom:"36px",letterSpacing:"2px",textTransform:"uppercase"}}>Canadian Voice Tutor · Toronto</div>
      <div style={{width:"100%",maxWidth:"360px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"24px",padding:"28px"}}>
        <div style={{fontSize:"14px",fontWeight:"600",marginBottom:"6px"}}>🔑 Anthropic API Key</div>
        <div style={{fontSize:"12px",color:"#7a8a9a",marginBottom:"18px",lineHeight:"1.7"}}>前往 <strong style={{color:"#4ECDC4"}}>console.anthropic.com</strong> 免费获取，只存本地。</div>
        <input type="password" value={apiKeyInput} onChange={e=>setApiKeyInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveKey()} placeholder="sk-ant-api03-..." style={{width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:"12px",padding:"13px 15px",color:"#e8e0d0",fontSize:"13px",outline:"none",fontFamily:"monospace",marginBottom:"12px"}}/>
        <button onClick={saveKey} style={{width:"100%",background:"linear-gradient(135deg,#c8102e,#ff4757)",border:"none",borderRadius:"12px",padding:"14px",color:"white",fontSize:"16px",fontWeight:"600",cursor:"pointer"}}>开始练习 🎤</button>
      </div>
    </div>
  );

  if (screen === "home") return (
    <div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"linear-gradient(160deg,#0a0e1a,#0d1f3c)",fontFamily:"Georgia,serif",color:"#e8e0d0",overflow:"hidden"}}>
      <div style={{background:"rgba(255,255,255,0.03)",borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <div style={{width:"42px",height:"42px",borderRadius:"50%",overflow:"hidden",border:"2px solid #c8102e",flexShrink:0}}>
            <img src={SARAH_PHOTO} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top"}} alt="Sarah"/>
          </div>
          <div>
            <div style={{fontSize:"18px",fontWeight:"700"}}>Sarah</div>
            <div style={{fontSize:"10px",color:"#7a8a9a",letterSpacing:"1.5px",textTransform:"uppercase"}}>Voice Tutor · Toronto 🎤</div>
          </div>
        </div>
        <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
          {streak.days > 0 && <div style={{background:"rgba(255,107,107,0.15)",border:"1px solid rgba(255,107,107,0.3)",borderRadius:"16px",padding:"4px 10px",fontSize:"12px",color:"#FF6B6B"}}>🔥 {streak.days}</div>}
          <button onClick={()=>setScreen("flashcards")} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:"20px",padding:"6px 14px",color:"#e8e0d0",cursor:"pointer",fontSize:"12px",display:"flex",alignItems:"center",gap:"5px",WebkitTapHighlightColor:"transparent"}}>
            📇 <span style={{background:reviewList.length>0?"#FF6B6B":"#4ECDC4",borderRadius:"10px",padding:"1px 7px",fontSize:"11px",fontFamily:"monospace"}}>{flashcards.length}</span>
          </button>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"18px 16px 28px"}}>
        <div style={{fontSize:"11px",letterSpacing:"3px",textTransform:"uppercase",color:"#c8102e",marginBottom:"10px",fontFamily:"monospace"}}>TODAY'S TOPIC</div>
        <div onClick={()=>startChat(todayTopic)} style={{background:"linear-gradient(135deg,rgba(200,16,46,0.18),rgba(200,16,46,0.06))",border:"1px solid rgba(200,16,46,0.35)",borderRadius:"20px",padding:"22px",marginBottom:"10px",cursor:"pointer",display:"flex",alignItems:"center",gap:"16px",WebkitTapHighlightColor:"transparent"}}>
          <div style={{fontSize:"42px",flexShrink:0}}>{todayTopic.emoji}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:"20px",fontWeight:"700",marginBottom:"4px"}}>{todayTopic.title}</div>
            <div style={{fontSize:"12px",color:"#8a9aaa",marginBottom:"12px"}}>{todayTopic.hint}</div>
            <div style={{background:"linear-gradient(135deg,#c8102e,#ff4757)",borderRadius:"24px",padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:"6px",fontSize:"13px",fontWeight:"600",boxShadow:"0 4px 16px rgba(200,16,46,0.4)"}}>🎤 Speak with Sarah</div>
          </div>
        </div>
        {reviewList.length > 0 && <div style={{background:"rgba(255,107,107,0.1)",border:"1px solid rgba(255,107,107,0.3)",borderRadius:"10px",padding:"8px 13px",marginBottom:"18px",fontSize:"12px",color:"#FF6B6B"}}>⚠️ {reviewList.length} word{reviewList.length>1?"s":""} to review — Sarah will quiz you!</div>}
        <div style={{fontSize:"11px",letterSpacing:"2px",textTransform:"uppercase",color:"#5a6a7a",marginBottom:"12px",fontFamily:"monospace"}}>ALL TOPICS</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
          {TOPICS.map((t,i)=>(
            <div key={i} onClick={()=>startChat(t)} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"14px",padding:"13px",cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
              <div style={{fontSize:"24px",marginBottom:"5px"}}>{t.emoji}</div>
              <div style={{fontSize:"13px",fontWeight:"600",marginBottom:"2px"}}>{t.title}</div>
              <div style={{fontSize:"11px",color:"#5a6a7a"}}>{t.hint}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (screen === "chat") return (
    <div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"#080c18",fontFamily:"Georgia,serif",color:"#e8e0d0",userSelect:"none"}}>
      <div style={{background:"rgba(255,255,255,0.03)",borderBottom:"1px solid rgba(255,255,255,0.07)",padding:"11px 15px",display:"flex",alignItems:"center",gap:"10px",flexShrink:0}}>
        <button onClick={()=>{window.speechSynthesis.cancel();stopMouthAnim();setScreen("home");}} style={{background:"none",border:"none",color:"#7a8a9a",cursor:"pointer",fontSize:"20px",padding:"4px 8px 4px 0",WebkitTapHighlightColor:"transparent"}}>←</button>
        <div style={{position:"relative",flexShrink:0}}>
          <div style={{width:"44px",height:"44px",borderRadius:"50%",overflow:"hidden",border:`2px solid ${speaking?"#ff4757":"rgba(200,16,46,0.5)"}`,boxShadow:speaking?"0 0 0 4px rgba(200,16,46,0.2), 0 0 0 8px rgba(200,16,46,0.08)":"none",transition:"all 0.3s"}}>
            <img src={SARAH_PHOTO} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top",filter:emotionFilter[emotion],transition:"filter 0.5s"}} alt="Sarah"/>
          </div>
          {speaking && (
            <div style={{position:"absolute",bottom:"4px",left:"50%",transform:"translateX(-50%)",width:mouthOpen?"16px":"12px",height:mouthOpen?"8px":"3px",background:"rgba(180,80,80,0.85)",borderRadius:"0 0 8px 8px",transition:"all 0.15s",border:"1px solid rgba(255,255,255,0.3)"}}/>
          )}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:"15px",fontWeight:"700"}}>Sarah</div>
          <div style={{fontSize:"11px",color:speaking?"#ff4757":loading?"#FFE66D":recording?"#ff4757":"#4ECDC4",transition:"color 0.3s"}}>
            {recording?"🔴 Listening...":speaking?"🔊 Speaking...":loading?"⏳ Thinking...":`● ${currentTopic?.title}`}
          </div>
        </div>
        <button onClick={()=>setScreen("flashcards")} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"14px",padding:"5px 11px",color:"#e8e0d0",cursor:"pointer",fontSize:"12px",flexShrink:0,WebkitTapHighlightColor:"transparent"}}>📇 {flashcards.length}</button>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"14px 13px 8px",display:"flex",flexDirection:"column",gap:"12px"}}>
        {messages.map((msg,i)=>(
          <div key={i}>
            {msg.role==="sarah"?(
              <div style={{display:"flex",gap:"8px",maxWidth:"90%"}}>
                <div style={{width:"30px",height:"30px",borderRadius:"50%",overflow:"hidden",flexShrink:0,marginTop:"2px",border:"1.5px solid rgba(200,16,46,0.4)"}}>
                  <img src={SARAH_PHOTO} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top"}} alt="S"/>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{background:"rgba(255,255,255,0.06)",borderRadius:"4px 16px 16px 16px",padding:"10px 13px",fontSize:"15px",lineHeight:"1.65",border:"1px solid rgba(255,255,255,0.08)"}}>
                    {msg.message}
                    <button onClick={()=>{setSpeaking(true);startMouthAnim();speak(msg.message,()=>{setSpeaking(false);stopMouthAnim();});}} style={{marginLeft:"8px",background:"none",border:"none",cursor:"pointer",fontSize:"13px",opacity:0.5,verticalAlign:"middle",WebkitTapHighlightColor:"transparent"}}>🔊</button>
                  </div>
                  {msg.teachingNote&&<div style={{marginTop:"5px",padding:"6px 10px",background:"rgba(255,230,109,0.08)",borderLeft:"3px solid #FFE66D",borderRadius:"0 8px 8px 0",fontSize:"12px",color:"#c8b87a"}}>💡 {msg.teachingNote}</div>}
                  {msg.newWords?.length>0&&<div style={{marginTop:"6px",display:"flex",flexWrap:"wrap",gap:"5px"}}>{msg.newWords.map((w,j)=><div key={j} style={{background:`${typeColor[w.type]||"#4ECDC4"}18`,border:`1px solid ${typeColor[w.type]||"#4ECDC4"}50`,borderRadius:"14px",padding:"3px 10px",fontSize:"11px",color:typeColor[w.type]||"#4ECDC4"}}>✨ <strong>{w.word}</strong> — {w.definition}</div>)}</div>}
                  {msg.quizResult&&<div style={{marginTop:"5px",padding:"6px 10px",background:msg.quizResult==="correct"?"rgba(168,230,207,0.1)":"rgba(255,107,107,0.1)",border:`1px solid ${msg.quizResult==="correct"?"rgba(168,230,207,0.3)":"rgba(255,107,107,0.3)"}`,borderRadius:"8px",fontSize:"11px",color:msg.quizResult==="correct"?"#A8E6CF":"#FF6B6B"}}>{msg.quizResult==="correct"?"✅ Great! Off review list.":msg.needsReview?"📌 Added to review!":"💪 Keep it up!"}</div>}
                </div>
              </div>
            ):(
              <div style={{display:"flex",justifyContent:"flex-end"}}>
                <div style={{background:"linear-gradient(135deg,#1a3a6e,#1e4080)",borderRadius:"16px 4px 16px 16px",padding:"10px 14px",fontSize:"15px",lineHeight:"1.65",maxWidth:"78%",border:"1px solid rgba(78,140,205,0.3)"}}>{msg.message}</div>
              </div>
            )}
          </div>
        ))}
        {(recording||liveText)&&<div style={{display:"flex",justifyContent:"flex-end"}}><div style={{background:"rgba(26,58,110,0.6)",borderRadius:"16px 4px 16px 16px",padding:"10px 14px",fontSize:"15px",lineHeight:"1.65",maxWidth:"78%",border:"1px dashed rgba(78,140,205,0.5)",color:liveText?"#e8e0d0":"#5a7aaa",fontStyle:liveText?"normal":"italic"}}>{liveText||"Listening..."}<span style={{display:"inline-block",width:"6px",height:"6px",background:"#ff4757",borderRadius:"50%",marginLeft:"6px",verticalAlign:"middle",animation:"blink 0.8s infinite"}}/></div></div>}
        {loading&&!recording&&<div style={{display:"flex",gap:"8px"}}><div style={{width:"30px",height:"30px",borderRadius:"50%",overflow:"hidden",flexShrink:0,border:"1.5px solid rgba(200,16,46,0.4)"}}><img src={SARAH_PHOTO} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top"}} alt="S"/></div><div style={{background:"rgba(255,255,255,0.06)",borderRadius:"4px 16px 16px 16px",padding:"12px 16px",border:"1px solid rgba(255,255,255,0.08)"}}><div style={{display:"flex",gap:"5px"}}>{[0,1,2].map(i=><div key={i} style={{width:"7px",height:"7px",borderRadius:"50%",background:"#c8102e",animation:`bounce 1s ease-in-out ${i*0.2}s infinite`}}/>)}</div></div></div>}
        <div ref={messagesEndRef}/>
      </div>

      <div style={{flexShrink:0,paddingTop:"14px",paddingBottom:"max(24px, env(safe-area-inset-bottom))",paddingLeft:"20px",paddingRight:"20px",display:"flex",flexDirection:"column",alignItems:"center",gap:"12px",background:"rgba(0,0,0,0.4)",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
        {speaking&&(
          <div style={{position:"relative",width:"80px",height:"80px",borderRadius:"50%",overflow:"hidden",border:"3px solid #ff4757",boxShadow:"0 0 0 6px rgba(200,16,46,0.2), 0 0 0 12px rgba(200,16,46,0.08)"}}>
            <img src={SARAH_PHOTO} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top",filter:emotionFilter[emotion]}} alt="Sarah"/>
            <div style={{position:"absolute",bottom:"10px",left:"50%",transform:"translateX(-50%)",width:mouthOpen?"22px":"14px",height:mouthOpen?"10px":"4px",background:"rgba(160,60,60,0.9)",borderRadius:"0 0 11px 11px",transition:"all 0.15s",border:"1px solid rgba(255,200,200,0.4)"}}/>
          </div>
        )}
        {quizActive&&!recording&&!loading&&!speaking&&<div style={{padding:"5px 14px",background:"rgba(78,205,196,0.1)",border:"1px solid rgba(78,205,196,0.25)",borderRadius:"18px",fontSize:"12px",color:"#4ECDC4"}}>🎯 Say <strong>"{quizActive}"</strong></div>}
        <div style={{height:"28px",display:"flex",alignItems:"center",gap:"3px",opacity:recording?1:0,transition:"opacity 0.2s"}}>
          {Array.from({length:18}).map((_,i)=>{const c=Math.abs(i-8.5)/8.5;const h=recording?Math.max(3,(1-c*0.4)*volumeLevel*28+Math.random()*4+3):3;return<div key={i} style={{width:"3px",borderRadius:"2px",background:`hsl(${350+volumeLevel*20},80%,60%)`,height:`${h}px`,transition:"height 0.07s"}}/>;} )}
        </div>
        <div onTouchStart={handleStart} onTouchEnd={handleEnd} onTouchCancel={handleEnd} onMouseDown={handleStart} onMouseUp={handleEnd} onMouseLeave={handleEnd}
          style={{width:"84px",height:"84px",borderRadius:"50%",background:recording?"radial-gradient(circle at 40% 35%,#ff6b6b,#c8102e)":speaking||loading?"rgba(200,16,46,0.25)":"linear-gradient(145deg,#e8182e,#a00020)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"36px",cursor:speaking||loading?"not-allowed":"pointer",boxShadow:recording?`0 0 0 ${6+volumeLevel*16}px rgba(200,16,46,0.25),0 0 0 ${12+volumeLevel*28}px rgba(200,16,46,0.1),0 8px 28px rgba(200,16,46,0.6)`:speaking?"0 0 0 6px rgba(200,16,46,0.2),0 8px 20px rgba(200,16,46,0.3)":"0 6px 26px rgba(200,16,46,0.5),inset 0 1px 0 rgba(255,255,255,0.2)",transition:"box-shadow 0.1s,background 0.2s,transform 0.1s",transform:recording?"scale(1.06)":"scale(1)",WebkitTapHighlightColor:"transparent",touchAction:"none"}}>
          {recording?"🎙️":speaking?"🔊":loading?"⏳":"🎤"}
        </div>
        <div style={{fontSize:"11px",color:recording?"#ff6b6b":"#4a5a6a",letterSpacing:"1px",textTransform:"uppercase",fontFamily:"monospace",transition:"color 0.3s"}}>
          {recording?"● RELEASE TO SEND":speaking?"Sarah is speaking":loading?"Thinking...":"HOLD TO SPEAK"}
        </div>
      </div>
      <style>{`@keyframes bounce{0%,80%,100%{transform:scale(0.6);opacity:0.4}40%{transform:scale(1);opacity:1}}@keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}`}</style>
    </div>
  );

  return (
    <div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"#0a0e1a",fontFamily:"Georgia,serif",color:"#e8e0d0"}}>
      <div style={{background:"rgba(255,255,255,0.03)",borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"14px 18px",display:"flex",alignItems:"center",gap:"10px",flexShrink:0}}>
        <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:"#7a8a9a",cursor:"pointer",fontSize:"20px",WebkitTapHighlightColor:"transparent"}}>←</button>
        <div style={{flex:1}}>
          <div style={{fontSize:"17px",fontWeight:"700"}}>My Flashcards</div>
          <div style={{fontSize:"11px",color:"#5a6a7a"}}>{flashcards.length} words learned from Sarah</div>
        </div>
        {reviewList.length>0&&<div style={{background:"rgba(255,107,107,0.15)",border:"1px solid rgba(255,107,107,0.3)",borderRadius:"14px",padding:"3px 11px",fontSize:"11px",color:"#FF6B6B"}}>⚠️ {reviewList.length}</div>}
      </div>
      <div style={{padding:"12px 16px",display:"flex",gap:"8px",flexShrink:0}}>
        {["all","review"].map(mode=><button key={mode} onClick={()=>setFilterMode(mode)} style={{background:filterMode===mode?"rgba(200,16,46,0.2)":"rgba(255,255,255,0.04)",border:`1px solid ${filterMode===mode?"rgba(200,16,46,0.5)":"rgba(255,255,255,0.1)"}`,borderRadius:"18px",padding:"6px 14px",color:filterMode===mode?"#ff4757":"#7a8a9a",cursor:"pointer",fontSize:"12px",fontFamily:"inherit",WebkitTapHighlightColor:"transparent"}}>{mode==="all"?`All (${flashcards.length})`:`Review (${reviewList.length})`}</button>)}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 14px 28px"}}>
        {displayCards.length===0?<div style={{textAlign:"center",padding:"60px 20px",color:"#5a6a7a"}}><div style={{fontSize:"48px",marginBottom:"14px"}}>{filterMode==="review"?"🎉":"📭"}</div><div style={{fontSize:"15px",marginBottom:"7px"}}>{filterMode==="review"?"Nothing to review!":"No cards yet"}</div><div style={{fontSize:"12px"}}>{filterMode==="review"?"Great job!":"Talk with Sarah to learn words."}</div></div>:(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
            {displayCards.map((card,i)=>(
              <div key={i} onClick={()=>setFlippedCard(flippedCard===i?null:i)} style={{background:flippedCard===i?"rgba(255,255,255,0.07)":"rgba(255,255,255,0.03)",border:`1px solid ${card.needsReview?"rgba(255,107,107,0.4)":"rgba(255,255,255,0.08)"}`,borderRadius:"14px",padding:"14px",cursor:"pointer",minHeight:"110px",display:"flex",flexDirection:"column",position:"relative",WebkitTapHighlightColor:"transparent"}}>
                {card.needsReview&&<div style={{position:"absolute",top:"8px",right:"8px",background:"#FF6B6B",borderRadius:"50%",width:"7px",height:"7px"}}/>}
                <div style={{display:"inline-block",padding:"2px 7px",borderRadius:"8px",background:`${typeColor[card.type]||"#4ECDC4"}20`,color:typeColor[card.type]||"#4ECDC4",fontSize:"9px",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"7px",fontFamily:"monospace",alignSelf:"flex-start"}}>{card.type?.replace("_"," ")||"word"}</div>
                <div style={{fontSize:"15px",fontWeight:"700",marginBottom:"5px"}}>{card.word}</div>
                {flippedCard===i?<div><div style={{fontSize:"12px",color:"#a0b0c0",marginBottom:"6px",lineHeight:"1.5"}}>{card.definition}</div><div style={{fontSize:"11px",color:"#5a7a8a",fontStyle:"italic",lineHeight:"1.5"}}>"{card.example}"</div><button onClick={e=>{e.stopPropagation();speak(card.word+". "+card.example);}} style={{marginTop:"8px",background:"rgba(255,255,255,0.08)",border:"none",borderRadius:"8px",padding:"4px 10px",color:"#a0b0c0",fontSize:"11px",cursor:"pointer",fontFamily:"inherit",WebkitTapHighlightColor:"transparent"}}>🔊 Listen</button></div>:<div style={{fontSize:"11px",color:"#4a5a6a"}}>Tap to reveal</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
