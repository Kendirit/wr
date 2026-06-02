import React, { useState, useEffect, useRef } from 'react';
import { 
  Star,
  Skull,
  Feather,
  Bird,
  Triangle,
  User, 
  Send, 
  Plus, 
  MapPin, 
  Backpack, 
  Trash2,
  ChevronRight,
  Loader2,
  Sword,
  Shield,
  Brain,
  MessageSquare,
  LogIn,
  Users,
  LogOut,
  Archive,
  Heart,
  BookOpen,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  addDoc, 
  where, 
  getDocs,
  getDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth, db } from './firebase';
import { cn } from './lib/utils';
import { Character, Message, GameInstance, GameState, UserProfile } from './types';
import { generateResponse, startAdventure, generateSummary } from './services/gemini';

const googleProvider = new GoogleAuthProvider();

const TALENTS_LIST = [
  "Olio cuore (+ostacoli)", "Iron Mike (+corpo a corpo)", "Run,run,run (+corsa)",
  "Cosa è stato? (+controllo area)", "Non sono stato io! (+mentire)", "I have a dream (+convincere)",
  "Bullseye (+armi distanza)", "Cowboy (+cavalcare)", "Abacadraba (+magia)",
  "Topo di biblioteca (+memoria)", "Cabron (+intimidire)", "You can't see me (+nascondersi)",
  "Mesa Verde (+scassinare)", "Stella polare (+orientamento)", "Marcantonio (+forza/res)",
  "Wololo (+cura)", "Touchè (+arma bianca)", "Poker (+azzardo)",
  "Santone (+cura/pozioni)", "Sherlock Holmes (+investigazione)", "Ramsay (+cucina)",
  "Ace Ventura (+animali)", "Art Attack (+artigianato)", "Blacksmith (+forgia)",
  "Sampei (+pesca)", "Monopoli (+falsificare)", "Bear Grills (+sopravvivenza)",
  "Pavarotti (+canto)", "Houdini (+liberarsi)", "Samurai (+arma bianca avanzato)"
];

export default function App() {
  const [user, loading, error] = useAuthState(auth);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [age, setAge] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [cookiesAccepted, setCookiesAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [marketingAccepted, setMarketingAccepted] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [playerName, setPlayerName] = useState(() => localStorage.getItem('wr_playerName') || '');
  const [instanceCode, setInstanceCode] = useState(() => localStorage.getItem('wr_instanceCode') || '');
  const [instanceNumber, setInstanceNumber] = useState(() => localStorage.getItem('wr_instanceNumber') || '1');
  const [adventurePreferences, setAdventurePreferences] = useState('');
  const [archivedInstances, setArchivedInstances] = useState<GameInstance[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  const [gameState, setGameState] = useState<GameState>({
    instance: null,
    character: null,
    messages: [],
    characters: [],
  });

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCharCreator, setShowCharCreator] = useState(false);
  const [newChar, setNewChar] = useState<Character>({
    name: '',
    role: 'Fuorilegge',
    background: '',
    level: 0,
    xp: 0,
    inventory: ['Pistola arrugginita', '5 proiettili', 'Borraccia d\'acqua'],
    talents: [],
    ownerId: '',
    isDead: false,
    currentPlane: 'Mondo Materiale'
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch User Profile
  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      return;
    }

    const docRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setUserProfile({ uid: user.uid, ...docSnap.data() } as UserProfile);
      } else {
        setUserProfile(null);
      }
    });

    return () => unsub();
  }, [user]);

  // Sync playerName with profile
  useEffect(() => {
    if (userProfile && !playerName) {
      const name = userProfile.email.split('@')[0];
      setPlayerName(name);
      localStorage.setItem('wr_playerName', name);
    }
  }, [userProfile, playerName]);

  // Fetch Archived Instances for Home Screen
  useEffect(() => {
    if (isLoggedIn || !user) return; // Only fetch if we have a user but aren't in a game yet
    const q = query(collection(db, 'instances'), where('status', '==', 'archived'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const instances = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as GameInstance));
      setArchivedInstances(instances);
    }, (error) => {
      console.warn("Firestore error on archived instances:", error);
    });
    return () => unsub();
  }, [isLoggedIn, user]);

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [gameState.messages]);

  // Listen to Instance Data
  useEffect(() => {
    if (!gameState.instance?.id || !isLoggedIn) return;

    const msgsQuery = query(collection(db, 'instances', gameState.instance.id, 'messages'), orderBy('timestamp', 'asc'));
    const charsQuery = collection(db, 'instances', gameState.instance.id, 'characters');

    const unsubMsgs = onSnapshot(msgsQuery, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message));
      setGameState(prev => ({ ...prev, messages: msgs }));
    });

    const unsubChars = onSnapshot(charsQuery, (snapshot) => {
      const chars = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Character));
      setGameState(prev => ({ ...prev, characters: chars }));
      
      // Find my character by ownerUid or fallback to playerName
      const myChar = chars.find(c => c.ownerUid === user?.uid || (!c.ownerUid && c.ownerId === playerName));
      if (myChar) {
        setGameState(prev => ({ ...prev, character: myChar }));
        setShowCharCreator(false);
      } else {
        setShowCharCreator(true);
      }
    });

    return () => {
      unsubMsgs();
      unsubChars();
    };
  }, [gameState.instance?.id, isLoggedIn, playerName]);

  const joinInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instanceCode || !playerName) return;
    
    const fullCode = `${instanceCode}${instanceNumber}`;
    setIsLoading(true);
    
    // Save to local storage for convenience
    localStorage.setItem('wr_playerName', playerName);
    localStorage.setItem('wr_instanceCode', instanceCode);
    localStorage.setItem('wr_instanceNumber', instanceNumber);

    try {
      const q = query(collection(db, 'instances'), where('code', '==', fullCode));
      const snap = await getDocs(q);
      
      let instanceId = '';
      let instanceData: any;

      if (snap.empty) {
        const newInst = await addDoc(collection(db, 'instances'), {
          code: fullCode,
          location: 'Longcross',
          createdAt: Date.now(),
          status: 'active',
          preferences: adventurePreferences
        });
        instanceId = newInst.id;
        instanceData = { 
          id: instanceId, 
          code: fullCode, 
          location: 'Longcross', 
          createdAt: Date.now(),
          status: 'active',
          preferences: adventurePreferences
        };
      } else {
        instanceId = snap.docs[0].id;
        instanceData = { id: instanceId, ...snap.docs[0].data() } as GameInstance;
      }

      setGameState(prev => ({ ...prev, instance: instanceData }));
      setIsLoggedIn(true);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateCharacter = async () => {
    if (!newChar.name || !gameState.instance) {
      console.error("Dati mancanti per la creazione del personaggio:", { name: newChar.name, instance: !!gameState.instance });
      return;
    }
    
    setIsLoading(true);
    try {
      const charData = { 
        ...newChar, 
        ownerId: playerName,
        ownerUid: user?.uid,
        background: newChar.background || 'Un misterioso viandante del West.'
      };
      
      console.log("Creazione personaggio in corso...", charData);
      
      const charRef = await addDoc(collection(db, 'instances', gameState.instance.id, 'characters'), charData);
      console.log("Personaggio creato con ID:", charRef.id);
      
      const intro = await startAdventure(charData, gameState.instance.preferences);
      await addDoc(collection(db, 'instances', gameState.instance.id, 'messages'), {
        role: 'model',
        text: intro,
        timestamp: Date.now(),
        authorName: 'Narratore'
      });
      
      setShowCharCreator(false);
    } catch (error) {
      console.error("Errore durante la creazione del personaggio:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading || !gameState.character || !gameState.instance) return;

    const userMsg = {
      role: 'user' as const,
      text: input,
      timestamp: Date.now(),
      authorName: gameState.character.name
    };

    setIsLoading(true);
    try {
      await addDoc(collection(db, 'instances', gameState.instance.id, 'messages'), userMsg);
      
      // Update XP
      const charRef = doc(db, 'instances', gameState.instance.id, 'characters', gameState.character.id!);
      await updateDoc(charRef, { xp: gameState.character.xp + 1 });

      const response = await generateResponse(
        gameState.instance,
        gameState.characters,
        [...gameState.messages, { ...userMsg, id: 'temp' }],
        input,
        gameState.character
      );

      await addDoc(collection(db, 'instances', gameState.instance.id, 'messages'), {
        role: 'model',
        text: response,
        timestamp: Date.now(),
        authorName: 'Narratore'
      });
    } catch (error) {
      console.error(error);
    } finally {
      setInput('');
      setIsLoading(false);
    }
  };

  const handleArchiveInstance = async () => {
    if (!gameState.instance || !gameState.messages.length) return;
    
    setIsLoading(true);
    try {
      const summary = await generateSummary(gameState.messages);
      const instRef = doc(db, 'instances', gameState.instance.id);
      await updateDoc(instRef, {
        status: 'archived',
        summary: summary
      });
      
      await addDoc(collection(db, 'instances', gameState.instance.id, 'messages'), {
        role: 'model',
        text: `--- AVVENTURA ARCHIVIATA ---\n\nRIASSUNTO GM: ${summary}\n\nQuesta istanza è ora chiusa. Potete usare questo riassunto come base per una nuova avventura!`,
        timestamp: Date.now(),
        authorName: 'Sistema'
      });
      
      setGameState(prev => prev.instance ? ({ 
        ...prev, 
        instance: { ...prev.instance, status: 'archived', summary } as GameInstance 
      }) : prev);
    } catch (error) {
      console.error("Errore durante l'archiviazione:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const leaveInstance = () => {
    setIsLoggedIn(false);
    setGameState({ instance: null, character: null, messages: [], characters: [] });
  };

  const handleSocialAuth = async (provider: GoogleAuthProvider) => {
    setAuthError(null);
    setIsLoading(true);
    try {
      const result = await signInWithPopup(auth, provider);
      // Check if profile exists, if not create basic one
      const docRef = doc(db, 'users', result.user.uid);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        await setDoc(docRef, {
          email: result.user.email || '',
          age: 18, // Default to 18 for social login placeholders
          ageConfirmed: true,
          cookiesAccepted: true,
          privacyAccepted: true,
          marketingAccepted: false,
          createdAt: Date.now()
        });
      }
    } catch (err: any) {
      setAuthError(err.message || "Errore durante l'accesso social.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoading(true);
    try {
      if (authMode === 'signup') {
        const ageNum = parseInt(age);
        if (isNaN(ageNum) || ageNum < 18) {
          throw new Error("Devi avere almeno 18 anni per giocare.");
        }
        if (!ageConfirmed || !cookiesAccepted || !privacyAccepted) {
          throw new Error("Devi accettare l'età, i cookie e la privacy policy.");
        }
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, 'users', userCred.user.uid), {
          email,
          age: ageNum,
          ageConfirmed: true,
          cookiesAccepted: true,
          privacyAccepted: true,
          marketingAccepted,
          createdAt: Date.now()
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      let msg = "Errore durante l'autenticazione.";
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') msg = "Email o password errati.";
      if (err.code === 'auth/email-already-in-use') msg = "Email già in uso.";
      if (err.code === 'auth/weak-password') msg = "Password troppo debole (min 6 caratteri).";
      setAuthError(err.message || msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = () => {
    signOut(auth);
    setIsLoggedIn(false);
    setGameState({ instance: null, character: null, messages: [], characters: [] });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#1a1614] flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-[#c4a484] animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#1a1614] flex flex-col items-center justify-center p-4 gap-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-[#26201c] border border-[#3d342d] p-8 rounded-3xl max-w-md w-full shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-[#c4a484]/20" />
          
          <div className="flex flex-col items-center gap-8 mb-12 text-center">
            <div className="flex items-end justify-center gap-10">
              {/* Stylized Indian Teepee */}
              <div className="relative w-16 h-32 flex items-end justify-center group">
                <div className="absolute inset-0 bg-[#c4a484]/5 blur-3xl rounded-full scale-150 animate-pulse" />
                {/* Teepee Body */}
                <div className="relative z-10 w-20 h-24 bg-[#26201c] border-x-2 border-b-2 border-[#c4a484]/40" style={{ clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }}>
                  {/* Entrance Slit */}
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-10 bg-[#1a1614] rounded-t-full" />
                </div>
                {/* Teepee Poles */}
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center justify-center -space-x-1">
                  <div className="w-[2px] h-32 bg-[#c4a484]/40 -rotate-[15deg] origin-bottom" />
                  <div className="w-[2px] h-32 bg-[#c4a484]/40 rotate-[15deg] origin-bottom" />
                </div>
                {/* Totem Bird on top */}
                <Bird size={14} className="absolute -top-6 text-[#c4a484] opacity-80" strokeWidth={1.5} />
              </div>

              {/* Sharper/Angular Cowboy Hat */}
              <div className="relative group flex flex-col items-center">
                <div className="absolute inset-0 bg-[#c4a484]/10 blur-3xl rounded-full scale-150" />
                {/* Aggressive Angular Crown */}
                <div 
                  className="w-20 h-14 bg-[#c4a484] relative overflow-hidden shadow-inner flex items-center justify-center"
                  style={{ clipPath: 'polygon(30% 0%, 70% 0%, 100% 100%, 0% 100%)' }}
                >
                  <div className="absolute bottom-2 left-0 w-full h-[5px] bg-[#1a1614]/60" /> {/* Hat Band */}
                  <Star size={14} className="text-[#1a1614]/70 fill-[#1a1614]/30 -mt-2" />
                </div>
                {/* Sharp Flat Brim */}
                <div className="w-36 h-2.5 bg-[#c4a484] -mt-0.5 shadow-2xl relative">
                  <div className="absolute inset-0 shadow-[inset_0_-3px_0px_rgba(0,0,0,0.4)]" />
                  <div className="absolute top-0 left-0 w-full h-[1px] bg-[#fdf2e9]/40" />
                </div>
              </div>
            </div>
            
            <div className="space-y-1">
              <h1 className="text-5xl font-bold text-[#c4a484] uppercase tracking-[-0.05em] drop-shadow-2xl">Western Redemption</h1>
              <div className="flex items-center justify-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-[#8c7a6b]">
                <div className="h-[1px] w-6 bg-[#c4a484]/20" />
                <span>Anno 1800</span>
                <div className="h-[1px] w-6 bg-[#c4a484]/20" />
              </div>
            </div>
            
            <p className="text-[#8c7a6b] text-sm font-serif italic max-w-[320px] leading-relaxed">
              Cronache di frontiera, onore e polvere.
            </p>
          </div>

          <div className="space-y-4">
            <button 
              onClick={() => handleSocialAuth(googleProvider)}
              disabled={isLoading}
              className="w-full bg-white text-gray-900 font-bold py-3.5 rounded-xl hover:bg-gray-100 active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-sm disabled:opacity-55"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-gray-900" />
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Entra con Google
                </>
              )}
            </button>

            {authError && (
              <p className="text-red-400 text-xs italic text-center mt-2">{authError}</p>
            )}

            <div className="p-4 bg-[#1a1614] rounded-xl border border-[#3d342d] text-[10px] text-[#8c7a6b] leading-relaxed shadow-inner mt-4">
              <span className="text-[#e0d5c1] font-bold block border-b border-[#3d342d] pb-1 uppercase tracking-tighter mb-1">
                Liberatoria di Gioco e Privacy
              </span>
              <p>
                Effettuando l'accesso con Google, dichiari di essere maggiorenne (18+) e acconsenti al trattamento della tua e-mail finalizzato esclusivamente alla gestione del profilo giocatore e ai salvataggi dei progressi di gioco. Comprendo che i testi generati sono frutto di una narrazione interattiva.
              </p>
            </div>
          </div>
        </motion.div>
        
        <div className="flex gap-4 text-[10px] text-[#5c5045] uppercase tracking-widest font-bold">
          <span>Storie dal Far West</span>
          <span>•</span>
          <span>Nuovo Messico 1800</span>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#1a1614] flex flex-col items-center justify-center p-4 gap-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-[#26201c] border border-[#3d342d] p-10 rounded-3xl max-w-md w-full shadow-2xl relative">
          <button 
            onClick={handleSignOut}
            className="absolute top-4 right-4 text-[#8c7a6b] hover:text-red-400 p-2 transition-colors"
            title="Esci"
          >
            <LogOut size={18} />
          </button>
          <div className="flex flex-col items-center gap-4 mb-8 text-center">
            <div className="flex items-end justify-center gap-4">
              {/* Mini Teepee */}
              <div className="relative w-8 h-10 flex items-end justify-center opacity-70">
                <div className="w-8 h-8 bg-[#c4a484]/10 border border-[#c4a484]/40" style={{ clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }} />
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-[1px] h-10 bg-[#c4a484]/40 rotate-[15deg]" />
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-[1px] h-10 bg-[#c4a484]/40 -rotate-[15deg]" />
              </div>
              {/* Mini Hat */}
              <div className="relative flex flex-col items-center">
                <div 
                  className="w-10 h-6 bg-[#c4a484]" 
                  style={{ clipPath: 'polygon(30% 0%, 70% 0%, 100% 100%, 0% 100%)' }}
                />
                <div className="w-16 h-1.5 bg-[#c4a484] -mt-0.5" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-[#c4a484] uppercase tracking-tighter">Western Redemption</h1>
            <p className="text-[#8c7a6b] text-xs font-mono uppercase tracking-widest">Istanza: Nuovo Messico • 1800</p>
          </div>
          
          <form onSubmit={joinInstance} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-[#8c7a6b] flex items-center gap-2">
                <Users size={14} /> Nome Istanza
              </label>
              <input type="text" value={instanceCode} onChange={e => setInstanceCode(e.target.value)} placeholder="es. CampagnaWest" className="w-full bg-[#1a1614] border border-[#3d342d] rounded-xl p-4 focus:outline-none focus:border-[#c4a484] text-[#e0d5c1]" />
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-[#8c7a6b] flex items-center gap-2">
                <Key size={14} /> Numero (1-100)
              </label>
              <input type="number" min="1" max="100" value={instanceNumber} onChange={e => setInstanceNumber(e.target.value)} className="w-full bg-[#1a1614] border border-[#3d342d] rounded-xl p-4 focus:outline-none focus:border-[#c4a484] text-[#e0d5c1]" />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-[#8c7a6b] flex items-center gap-2">
                <User size={14} /> Il Tuo Nome Giocatore
              </label>
              <input type="text" value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="es. TexWiller" className="w-full bg-[#1a1614] border border-[#3d342d] rounded-xl p-4 focus:outline-none focus:border-[#c4a484] text-[#e0d5c1]" />
              <p className="text-[10px] text-[#8c7a6b] italic">Usa lo stesso nome per riprendere il tuo personaggio.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-[#8c7a6b] flex items-center gap-2">
                <Star size={14} className="fill-[#c4a484]/20" /> Preferenze Avventura (Opzionale)
              </label>
              <textarea 
                value={adventurePreferences} 
                onChange={e => setAdventurePreferences(e.target.value)} 
                placeholder="es. Più azione, focus sui Navajo, toni horror..." 
                className="w-full bg-[#1a1614] border border-[#3d342d] rounded-xl p-4 focus:outline-none focus:border-[#c4a484] text-[#e0d5c1] resize-none h-24" 
              />
            </div>

            <button type="submit" disabled={!instanceCode || !playerName || isLoading} className="w-full bg-[#c4a484] text-[#1a1614] font-bold py-4 rounded-xl hover:bg-[#b09375] transition-all flex items-center justify-center gap-2 shadow-lg">
              {isLoading ? <Loader2 className="animate-spin" /> : <ChevronRight />} Entra nel West
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-[#3d342d] space-y-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8c7a6b] flex items-center gap-2">
              <LogIn size={12} /> Guida alla Compilazione
            </h3>
            <div className="grid grid-cols-1 gap-3 text-[11px] text-[#8c7a6b] leading-relaxed">
              <div className="bg-[#1a1614] p-3 rounded-lg border border-[#3d342d]">
                <span className="text-[#c4a484] font-bold">1. Nome Istanza:</span> È il titolo della tua avventura. Scegline uno nuovo per iniziare una storia da zero o uno esistente per unirti a una campagna.
              </div>
              <div className="bg-[#1a1614] p-3 rounded-lg border border-[#3d342d]">
                <span className="text-[#c4a484] font-bold">2. Numero:</span> È il "canale". Per giocare insieme a un amico, inserite lo <span className="underline">stesso nome</span> e lo <span className="underline">stesso numero</span>.
              </div>
              <div className="bg-[#1a1614] p-3 rounded-lg border border-[#3d342d]">
                <span className="text-[#c4a484] font-bold">3. Nome Giocatore:</span> È la tua firma. Usalo per riprendere il tuo personaggio e i tuoi XP in qualsiasi momento.
              </div>
              <div className="bg-[#1a1614] p-3 rounded-lg border border-[#3d342d]">
                <span className="text-[#c4a484] font-bold">4. Preferenze:</span> Opzionale. Scrivi qui se vuoi un'avventura horror, investigativa o piena di sparatorie!
              </div>
            </div>
          </div>
        </motion.div>

        {archivedInstances.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl w-full space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[#8c7a6b] text-center flex items-center justify-center gap-2">
              <BookOpen size={14} /> Bacheca delle Avventure Archiviate
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {archivedInstances.map(inst => (
                <div key={inst.id} className="bg-[#26201c] border border-[#3d342d] p-6 rounded-2xl shadow-xl space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono text-[#c4a484] uppercase tracking-widest">{inst.code}</span>
                    <span className="text-[10px] text-[#8c7a6b]">{new Date(inst.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-xs text-[#e0d5c1] leading-relaxed italic line-clamp-4">
                    "{inst.summary}"
                  </p>
                  <div className="pt-2 flex justify-between items-center border-t border-[#3d342d]">
                    <span className="text-[9px] uppercase font-bold text-[#8c7a6b]">Locazione: {inst.location}</span>
                    <button 
                      onClick={() => {
                        const codeMatch = inst.code.match(/^(.*?)(\d+)$/);
                        if (codeMatch) {
                          setInstanceCode(codeMatch[1]);
                          setInstanceNumber(codeMatch[2]);
                        }
                      }}
                      className="text-[9px] uppercase font-bold text-[#c4a484] hover:underline"
                    >
                      Usa come traccia
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  const nextLevelXp = gameState.character ? (gameState.character.level + 1) * 100 : 100;
  const currentLevelXp = gameState.character ? gameState.character.level * 100 : 0;
  const progress = gameState.character ? ((gameState.character.xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#1a1614] text-[#e0d5c1] font-sans selection:bg-[#c4a484] selection:text-[#1a1614]">
      <div className="fixed inset-0 pointer-events-none opacity-5 bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />

      <header className="border-b border-[#3d342d] bg-[#26201c] p-4 sticky top-0 z-10 shadow-xl">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="flex items-end gap-2">
              {/* Mini Teepee Icon */}
              <div className="relative w-6 h-6 flex items-end justify-center opacity-40">
                <div className="w-6 h-5 bg-[#c4a484]/20" style={{ clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }} />
                <div className="absolute -top-1 w-[0.5px] h-7 bg-[#c4a484]/40 rotate-12" />
              </div>
              {/* Mini Hat Icon */}
              <div className="relative flex flex-col items-center opacity-80">
                <div 
                  className="w-7 h-4 bg-[#c4a484]" 
                  style={{ clipPath: 'polygon(30% 0%, 70% 0%, 100% 100%, 0% 100%)' }}
                />
                <div className="w-12 h-1 bg-[#c4a484] -mt-0.5" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tighter text-[#c4a484] uppercase">WR</h1>
              <p className="text-[9px] text-[#8c7a6b] font-mono uppercase tracking-[0.2em]">Frontiera 1800</p>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            {gameState.character && (
              <div className="hidden md:flex flex-col items-end gap-1">
                <div className="text-[10px] uppercase font-bold text-[#8c7a6b]">Lvl {gameState.character.level} • {gameState.character.xp} XP</div>
                <div className="w-32 h-1 bg-[#1a1614] rounded-full overflow-hidden border border-[#3d342d]">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} className="h-full bg-[#c4a484]" />
                </div>
              </div>
            )}
            {gameState.instance?.status === 'active' && (
              <button 
                onClick={handleArchiveInstance}
                disabled={isLoading}
                className="hidden md:flex items-center gap-2 text-[10px] uppercase font-bold text-[#8c7a6b] hover:text-[#c4a484] transition-colors"
                title="Archivia e genera riassunto"
              >
                <Archive size={14} /> {isLoading ? 'Archiviazione...' : 'Archivia Giocata'}
              </button>
            )}
            <button onClick={handleSignOut} className="p-2 hover:bg-[#3d342d] rounded-full transition-colors text-[#8c7a6b] hover:text-red-400" title="Esci (Logout)">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        <aside className="lg:col-span-1 space-y-6 order-2 lg:order-1">
          {gameState.character && (
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <div className="bg-[#26201c] border border-[#3d342d] rounded-xl p-5 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-5"><User size={64} /></div>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h2 className="text-xl font-bold text-[#c4a484]">{gameState.character.name}</h2>
                    <p className="text-xs text-[#8c7a6b] uppercase tracking-widest">{gameState.character.role}</p>
                  </div>
                  <div className="bg-[#c4a484] text-[#1a1614] px-2 py-1 rounded text-[10px] font-bold uppercase">Lvl {gameState.character.level}</div>
                </div>
                
                <div className="flex items-center gap-2 text-sm mt-4"><MapPin size={14} className="text-[#c4a484]" /> {gameState.instance?.location}</div>
              </div>

              <div className="bg-[#26201c] border border-[#3d342d] rounded-xl p-5 shadow-lg">
                <h3 className="text-[10px] font-bold text-[#8c7a6b] uppercase tracking-widest mb-4 flex items-center gap-2"><Users size={14} /> Giocatori Online</h3>
                <div className="space-y-2">
                  {gameState.characters.map(c => (
                    <div key={c.id} className="flex items-center gap-2 text-xs">
                      <div className={cn("w-1.5 h-1.5 rounded-full", c.ownerId === playerName ? "bg-green-500" : "bg-[#c4a484]")} />
                      <span className={c.ownerId === playerName ? "text-[#c4a484] font-bold" : ""}>{c.name}</span>
                      <span className="text-[10px] text-[#8c7a6b]">({c.role})</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </aside>

        <section className="lg:col-span-3 flex flex-col h-[calc(100vh-12rem)] order-1 lg:order-2">
          <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-6 pr-4 scrollbar-thin scrollbar-thumb-[#3d342d] scrollbar-track-transparent">
            {gameState.messages.map((msg) => (
              <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("flex flex-col max-w-[85%]", msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start")}>
                <div className={cn("p-4 rounded-2xl text-sm leading-relaxed shadow-md", msg.role === 'user' ? "bg-[#c4a484] text-[#1a1614] rounded-tr-none" : "bg-[#26201c] border border-[#3d342d] text-[#e0d5c1] rounded-tl-none")}>
                  {msg.role === 'model' ? <div className="prose prose-invert prose-sm max-w-none"><ReactMarkdown>{msg.text}</ReactMarkdown></div> : msg.text}
                </div>
                <span className="text-[9px] uppercase tracking-tighter text-[#8c7a6b] mt-1 px-1">
                  {msg.authorName || (msg.role === 'user' ? 'Giocatore' : 'Narratore')} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </motion.div>
            ))}
            {isLoading && <div className="flex items-center gap-3 text-[#8c7a6b] text-xs italic animate-pulse"><Loader2 className="animate-spin" size={14} /> Il Narratore sta scrivendo...</div>}
          </div>

          {gameState.character && (
            <form onSubmit={handleSendMessage} className="mt-6 relative">
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Cosa fai? (es. Entro nel saloon...)" disabled={isLoading} className="w-full bg-[#26201c] border border-[#3d342d] rounded-xl py-4 pl-5 pr-16 text-[#e0d5c1] placeholder-[#8c7a6b] focus:outline-none focus:border-[#c4a484] shadow-2xl" />
              <button type="submit" disabled={isLoading || !input.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-[#c4a484] text-[#1a1614] rounded-lg hover:bg-[#b09375] disabled:opacity-50 transition-all"><Send size={20} /></button>
            </form>
          )}
        </section>
      </main>

      <AnimatePresence>
        {showCharCreator && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1a1614]/90 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-[#26201c] border border-[#3d342d] rounded-2xl p-8 max-w-2xl w-full shadow-2xl overflow-y-auto max-h-[90vh]">
              <h2 className="text-2xl font-bold text-[#c4a484] mb-6 uppercase tracking-tighter">Crea il tuo Personaggio</h2>
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#8c7a6b]">Nome</label>
                    <input type="text" value={newChar.name} onChange={e => setNewChar({...newChar, name: e.target.value})} className="w-full bg-[#1a1614] border border-[#3d342d] rounded-lg p-3" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#8c7a6b]">Ruolo</label>
                    <input type="text" value={newChar.role} onChange={e => setNewChar({...newChar, role: e.target.value})} className="w-full bg-[#1a1614] border border-[#3d342d] rounded-lg p-3" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#8c7a6b]">Livello Iniziale</label>
                    <input type="number" min="0" value={newChar.level} onChange={e => setNewChar({...newChar, level: parseInt(e.target.value) || 0})} className="w-full bg-[#1a1614] border border-[#3d342d] rounded-lg p-3" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-[#8c7a6b]">Background</label>
                  <textarea rows={3} value={newChar.background} onChange={e => setNewChar({...newChar, background: e.target.value})} className="w-full bg-[#1a1614] border border-[#3d342d] rounded-lg p-3 resize-none" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-[#8c7a6b]">Talenti ({newChar.talents.length}/{newChar.level + 1})</label>
                    <span className="text-[8px] text-[#8c7a6b] uppercase">Limite: Livello + 1</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 max-h-32 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-[#3d342d]">
                    {TALENTS_LIST.map(t => {
                      const isSelected = newChar.talents.includes(t);
                      const limitReached = newChar.talents.length >= newChar.level + 1;
                      return (
                        <button 
                          key={t} 
                          onClick={() => {
                            if (isSelected) {
                              setNewChar({...newChar, talents: newChar.talents.filter(x => x !== t)});
                            } else if (!limitReached) {
                              setNewChar({...newChar, talents: [...newChar.talents, t]});
                            }
                          }} 
                          className={cn(
                            "text-[8px] p-2 rounded border uppercase font-bold transition-all", 
                            isSelected ? "bg-[#c4a484] text-[#1a1614] border-[#c4a484]" : "bg-[#1a1614] text-[#8c7a6b] border-[#3d342d]",
                            (!isSelected && limitReached) && "opacity-30 cursor-not-allowed"
                          )}
                        >
                          {t.split(' (')[0]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button onClick={handleCreateCharacter} disabled={!newChar.name || isLoading} className="w-full bg-[#c4a484] text-[#1a1614] font-bold py-4 rounded-xl hover:bg-[#b09375] transition-all flex items-center justify-center gap-2">
                  {isLoading ? (
                    <>
                      <Loader2 className="animate-spin" />
                      <span>Il Narratore sta preparando la tua storia...</span>
                    </>
                  ) : (
                    <>
                      <ChevronRight />
                      <span>Inizia l'Avventura</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

