import React, { useState, useEffect, useRef } from 'react';
import {
    StyleSheet, Text, View, TextInput, TouchableOpacity,
    ScrollView, Alert, Platform, ActivityIndicator, StatusBar,
    SafeAreaView, Modal
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import FileSystem hanya jika bukan Web untuk menghindari error
let FileSystem;
if (Platform.OS !== 'web') {
    FileSystem = require('expo-file-system');
}

// ⚠️ GANTI IP DI SINI
const API_URL = '';
// Direktori simpan (Hanya untuk Native)
const DIR_RECORDINGS = Platform.OS !== 'web'
    ? FileSystem.documentDirectory + 'recordings/'
    : null;

// Helper: Format Timer (00:00)
const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
};

// Component Input
const ModernInput = ({ icon, placeholder, value, onChangeText, keyboardType }) => (
    <View style={styles.inputContainer}>
        <View style={styles.inputIcon}>
            <Ionicons name={icon} size={20} color="#6366f1" />
        </View>
        <TextInput
            style={styles.input}
            placeholder={placeholder}
            placeholderTextColor="#94a3b8"
            value={value}
            onChangeText={onChangeText}
            keyboardType={keyboardType}
        />
    </View>
);

export default function App() {
    const [permission, requestPermission] = useCameraPermissions();
    const [isProcessingRecord, setIsProcessingRecord] = useState(false);
    // --- STATES ---
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [sentences, setSentences] = useState([]);

    // User Data
    const [meta, setMeta] = useState({ name: '', age: '', gender: 'Laki-laki' });
    const [isProfileSaved, setIsProfileSaved] = useState(false);

    // Recording State
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isRecording, setIsRecording] = useState(false);
    const [recordTime, setRecordTime] = useState(0);

    // Refs
    const cameraRef = useRef(null); // Native Camera Ref
    const webRecorderRef = useRef(null); // Web MediaRecorder Ref
    const webChunksRef = useRef([]); // Web Video Data Chunks
    const timerInterval = useRef(null);

    // Data Queue
    const [queue, setQueue] = useState([]);

    // Preview
    const [previewModalVisible, setPreviewModalVisible] = useState(false);
    const [selectedVideo, setSelectedVideo] = useState(null);

    // --- INIT ---
    useEffect(() => {
        if (Platform.OS !== 'web') {
            requestPermission();
            ensureDirExists();
        }
        loadQueue();
        loadUserProfile();
    }, []);

    // --- LOGIC PENYIMPANAN DATA DIRI ---
    const loadUserProfile = async () => {
        try {
            const savedMeta = await AsyncStorage.getItem('user_meta');
            if (savedMeta) {
                setMeta(JSON.parse(savedMeta));
                setIsProfileSaved(true);
            }
        } catch (e) { console.log(e); }
    };

    const saveUserProfile = async () => {
        if (!meta.name || !meta.age) {
            Alert.alert("Error", "Nama dan Umur wajib diisi!");
            return false;
        }
        try {
            await AsyncStorage.setItem('user_meta', JSON.stringify(meta));
            setIsProfileSaved(true);
            return true;
        } catch (e) { return false; }
    };

    const resetUserProfile = async () => {
        Alert.alert("Ganti Data", "Anda yakin ingin mengubah data diri?", [
            { text: "Batal", style: "cancel" },
            {
                text: "Ya, Ubah", onPress: async () => {
                    await AsyncStorage.removeItem('user_meta');
                    setMeta({ name: '', age: '', gender: 'Laki-laki' });
                    setIsProfileSaved(false);
                    setStep(1);
                }
            }
        ]);
    };

    // --- LOGIC FILE & QUEUE ---
    const ensureDirExists = async () => {
        if (Platform.OS === 'web') return; // Web tidak butuh folder
        try {
            const dirInfo = await FileSystem.getInfoAsync(DIR_RECORDINGS);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(DIR_RECORDINGS, { intermediates: true });
            }
        } catch (e) { console.log(e); }
    };

    const loadQueue = async () => {
        try {
            const savedQueue = await AsyncStorage.getItem('offline_queue');
            if (savedQueue) setQueue(JSON.parse(savedQueue));
        } catch (error) { console.log(error); }
    };

    const saveQueueToStorage = async (newQueue) => {
        setQueue(newQueue);
        await AsyncStorage.setItem('offline_queue', JSON.stringify(newQueue));
    };

    // --- FETCH SENTENCES ---
    const fetchSentences = async () => {
        const saved = await saveUserProfile();
        if (!saved) return;

        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/sentences?limit=50`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                setSentences(data);
                setStep(2);
            } else {
                Alert.alert("Info", "Database server kosong.");
            }
        } catch (error) {
            // Jika offline, dan sudah ada data sebelumnya, kita bisa lanjut (opsional)
            // Disini kita alert saja
            Alert.alert("Koneksi", "Gagal mengambil skrip baru. Pastikan server nyala.");
        } finally {
            setLoading(false);
        }
    };

    // --- RECORDING LOGIC (UNIVERSAL: WEB & NATIVE) ---

    const startTimer = () => {
        setRecordTime(0);
        timerInterval.current = setInterval(() => {
            setRecordTime((prev) => prev + 1);
        }, 1000);
    };

    const stopTimer = () => {
        if (timerInterval.current) {
            clearInterval(timerInterval.current);
            timerInterval.current = null;
        }
        setRecordTime(0);
    };

    const startRecording = async () => {
        setIsProcessingRecord(true); // Kunci tombol saat jeda

        // 1. WEB RECORDING LOGIC
        if (Platform.OS === 'web') {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                const mediaRecorder = new MediaRecorder(stream);

                webChunksRef.current = [];
                webRecorderRef.current = mediaRecorder;

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) webChunksRef.current.push(event.data);
                };

                mediaRecorder.onstop = async () => {
                    const blob = new Blob(webChunksRef.current, { type: 'video/mp4' });
                    const videoUrl = URL.createObjectURL(blob);
                    await processRecordedVideo(videoUrl);
                    stream.getTracks().forEach(track => track.stop());
                };

                // MULAI REKAM SEKARANG (kamera merekam senyap)
                mediaRecorder.start();

                // Tunggu 200ms baru beri aba-aba (UI) ke user untuk ngomong
                setTimeout(() => {
                    setIsRecording(true);
                    setIsProcessingRecord(false); // Buka kunci tombol
                    startTimer();
                }, 200);

            } catch (err) {
                console.error("Web Camera Error:", err);
                Alert.alert("Error", "Gagal akses kamera. Pastikan Insecure Origin diizinkan di Chrome.");
                setIsProcessingRecord(false);
            }
        }
        // 2. NATIVE RECORDING LOGIC (Android/iOS)
        else {
            if (cameraRef.current) {
                try {
                    // Tunggu 200ms baru beri aba-aba UI
                    setTimeout(() => {
                        setIsRecording(true);
                        setIsProcessingRecord(false);
                        startTimer();
                    }, 200);

                    // Kamera HP mulai merekam di latar belakang
                    const video = await cameraRef.current.recordAsync({ maxDuration: 60 });

                    // Blok ini tereksekusi SETELAH stopRecording dipanggil
                    stopTimer();
                    setIsRecording(false);

                    const filename = `rec_${Date.now()}.mp4`;
                    const newPath = DIR_RECORDINGS + filename;
                    await FileSystem.moveAsync({ from: video.uri, to: newPath });

                    await processRecordedVideo(newPath);

                } catch (e) {
                    stopTimer();
                    setIsRecording(false);
                    setIsProcessingRecord(false);
                    Alert.alert("Error", "Gagal merekam di HP.");
                }
            }
        }
    };

    const stopRecording = () => {
        if (!isRecording) return;
        setIsProcessingRecord(true); // Kunci tombol agar tidak di-klik dobel

        // Jeda 200ms sebelum benar-benar mematikan rekaman (merekam ujung suara)
        setTimeout(() => {
            if (Platform.OS === 'web') {
                if (webRecorderRef.current && webRecorderRef.current.state === 'recording') {
                    webRecorderRef.current.stop();
                }
            } else {
                if (cameraRef.current) {
                    cameraRef.current.stopRecording();
                }
            }
            setIsRecording(false);
            stopTimer();
            setIsProcessingRecord(false); // Buka kunci
        }, 200);
    };

    // Helper untuk memproses hasil video (Web & Native)
    const processRecordedVideo = async (uri) => {
        const currentSentence = sentences[currentIndex] || { id: 0, text: "Unknown" };

        const newRecord = {
            id: Date.now().toString(),
            uri: uri, // Di Web ini Blob URL, di HP ini File Path
            sentenceId: currentSentence.id,
            text: currentSentence.text,
            metadata: meta,
            uploaded: false,
            date: new Date().toISOString()
        };

        const updatedQueue = [...queue, newRecord];
        await saveQueueToStorage(updatedQueue);

        if (currentIndex < sentences.length - 1) {
            setCurrentIndex(prev => prev + 1);
        } else {
            Alert.alert("Selesai!", "Sesi ini selesai. Cek galeri.");
            setStep(3);
        }
    };

    // --- DELETE LOGIC (FIXED FOR WEB & NATIVE) ---
    const deleteRecording = async (id) => {
        // 1. Fungsi inti untuk menghapus data
        const executeDelete = async () => {
            try {
                const target = queue.find(q => q.id === id);
                if (!target) return;

                // Hapus file fisik (Hanya di HP/Native)
                if (Platform.OS !== 'web') {
                    try {
                        await FileSystem.deleteAsync(target.uri, { idempotent: true });
                    } catch (e) {
                        console.log("File fisik mungkin sudah hilang/error:", e);
                    }
                } else {
                    // Di Web, bersihkan memory blob agar tidak berat
                    if (target.uri) {
                        URL.revokeObjectURL(target.uri);
                    }
                }

                // Update State (Hapus dari layar)
                const updated = queue.filter(q => q.id !== id);
                setQueue(updated);

                // Simpan perubahan ke penyimpanan lokal
                await AsyncStorage.setItem('offline_queue', JSON.stringify(updated));

            } catch (error) {
                console.error("Gagal menghapus:", error);
                Alert.alert("Error", "Gagal menghapus data.");
            }
        };

        // 2. Tampilkan Konfirmasi (Beda cara Web vs HP)
        if (Platform.OS === 'web') {
            // --- WEB: Pakai window.confirm ---
            const isConfirmed = window.confirm("Apakah Anda yakin ingin menghapus video ini?");
            if (isConfirmed) {
                await executeDelete();
            }
        } else {
            // --- HP (Android/iOS): Pakai Alert.alert ---
            Alert.alert(
                "Hapus Video",
                "Video akan dihapus permanen. Lanjutkan?",
                [
                    { text: "Batal", style: "cancel" },
                    {
                        text: "Hapus",
                        style: "destructive",
                        onPress: executeDelete
                    }
                ]
            );
        }
    };

    const uploadAll = async () => {
        setLoading(true);
        let successCount = 0;
        const pending = queue.filter(q => !q.uploaded);

        if (pending.length === 0) {
            Alert.alert("Info", "Semua video sudah terupload.");
            setLoading(false);
            return;
        }

        for (const rec of pending) {
            const formData = new FormData();

            // ⚠️ PENTING: Append Data Teks DULUAN sebelum Video
            // Agar folder di server terbaca namanya (Bukan 'undefined')
            formData.append('userName', rec.metadata.name);
            formData.append('userAge', rec.metadata.age);
            formData.append('userGender', rec.metadata.gender);
            formData.append('sentenceId', rec.sentenceId);
            // Kirim teks kalimat agar bisa disimpan jadi .txt
            formData.append('sentenceText', rec.text);

            // BARU Append Video TERAKHIR
            if (Platform.OS === 'web') {
                const response = await fetch(rec.uri);
                const blob = await response.blob();
                formData.append('video', blob, `video_${rec.sentenceId}.mp4`);
            } else {
                formData.append('video', {
                    uri: rec.uri,
                    name: `video_${rec.sentenceId}.mp4`,
                    type: 'video/mp4'
                });
            }

            try {
                const res = await fetch(`${API_URL}/api/upload`, {
                    method: 'POST',
                    body: formData,
                    headers: {
                        // Jangan set 'Content-Type': 'multipart/form-data' secara manual!
                        // Biarkan fetch yang mengaturnya agar boundary terbaca.
                        'Accept': 'application/json',
                    }
                });

                if (res.ok) {
                    rec.uploaded = true;
                    successCount++;
                } else {
                    console.log("Upload failed status:", res.status);
                }
            } catch (e) { console.log("Upload error:", e); }
        }

        await saveQueueToStorage([...queue]);
        setLoading(false);
        Alert.alert("Hasil Upload", `Berhasil: ${successCount} video.`);
    };

    // --- FUNGSI HAPUS SEMUA DATA (CLEAR ALL) ---
    const clearAllRecordings = async () => {
        const executeClear = async () => {
            setLoading(true);
            try {
                // 1. Bersihkan file fisik (HP) atau memori browser (Web)
                for (const item of queue) {
                    if (Platform.OS !== 'web') {
                        try {
                            await FileSystem.deleteAsync(item.uri, { idempotent: true });
                        } catch (e) {
                            console.log("File fisik error/hilang:", e);
                        }
                    } else {
                        // Bersihkan URL Blob di Web agar tidak bocor memori
                        if (item.uri) {
                            URL.revokeObjectURL(item.uri);
                        }
                    }
                }

                // 2. Kosongkan State dan AsyncStorage
                setQueue([]);
                await AsyncStorage.setItem('offline_queue', JSON.stringify([]));

            } catch (error) {
                console.error("Gagal menghapus semua:", error);
                Alert.alert("Error", "Terjadi kesalahan saat menghapus data.");
            } finally {
                setLoading(false);
            }
        };

        // Konfirmasi sebelum mengeksekusi (Beda UI Web vs HP)
        if (Platform.OS === 'web') {
            const isConfirmed = window.confirm("PERINGATAN: Anda yakin ingin menghapus SEMUA rekaman di galeri?");
            if (isConfirmed) {
                await executeClear();
            }
        } else {
            Alert.alert(
                "Hapus Semua Rekaman",
                "Semua data yang belum diupload akan dihapus permanen. Lanjutkan?",
                [
                    { text: "Batal", style: "cancel" },
                    { text: "Hapus Semua", style: "destructive", onPress: executeClear }
                ]
            );
        }
    };

    // =================================================================
    // UI
    // =================================================================

    if (step === 1) {
        return (
            <SafeAreaView style={styles.mainContainer}>
                <StatusBar barStyle="dark-content" />
                <View style={styles.header}>
                    <View style={styles.logoBadge}><Ionicons name="videocam" size={32} color="white" /></View>
                    <Text style={styles.title}>Dataset<Text style={{ color: '#6366f1' }}>Recorder</Text></Text>
                    <Text style={styles.subtitle}>{isProfileSaved ? `Halo, ${meta.name}!` : "Selamat Datang"}</Text>
                </View>

                <View style={styles.card}>
                    {isProfileSaved ? (
                        <View style={{ alignItems: 'center', padding: 10 }}>
                            <Ionicons name="person-circle" size={80} color="#6366f1" />
                            <Text style={{ fontSize: 20, fontWeight: 'bold', marginTop: 10 }}>{meta.name}</Text>
                            <Text style={{ color: '#64748b' }}>{meta.age} Tahun • {meta.gender}</Text>
                            <TouchableOpacity onPress={resetUserProfile} style={styles.btnOutline}>
                                <Ionicons name="create-outline" size={18} color="#6366f1" />
                                <Text style={{ color: '#6366f1', marginLeft: 5, fontWeight: '600' }}>Edit Data Diri</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <>
                            <Text style={styles.label}>Data Responden</Text>
                            <ModernInput icon="person" placeholder="Nama Lengkap" value={meta.name} onChangeText={(t) => setMeta({ ...meta, name: t })} />
                            <ModernInput icon="calendar" placeholder="Umur" value={meta.age} onChangeText={(t) => setMeta({ ...meta, age: t })} keyboardType="numeric" />
                            <Text style={styles.label}>Jenis Kelamin</Text>
                            <View style={styles.genderRow}>
                                {['Laki-laki', 'Perempuan'].map((g) => (
                                    <TouchableOpacity key={g} style={[styles.genderBtn, meta.gender === g && styles.genderBtnActive]} onPress={() => setMeta({ ...meta, gender: g })}>
                                        <Ionicons name={g === 'Laki-laki' ? 'male' : 'female'} size={18} color={meta.gender === g ? 'white' : '#64748b'} />
                                        <Text style={[styles.genderText, meta.gender === g && styles.genderTextActive]}>{g}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </>
                    )}
                </View>

                <View style={styles.bottomAction}>
                    <TouchableOpacity style={styles.btnPrimary} onPress={fetchSentences}>
                        {loading ? <ActivityIndicator color="white" /> : (
                            <>
                                <Text style={styles.btnTextPrimary}>Mulai Sesi Rekaman</Text>
                                <Ionicons name="arrow-forward" size={20} color="white" />
                            </>
                        )}
                    </TouchableOpacity>

                    {queue.length > 0 && (
                        <TouchableOpacity style={styles.btnSecondary} onPress={() => setStep(3)}>
                            <Text style={styles.btnTextSecondary}>Lihat Galeri ({queue.length})</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </SafeAreaView>
        );
    }

    // STEP 2: CAMERA
    if (step === 2) {
        const item = sentences[currentIndex];
        return (
            <View style={{ flex: 1, backgroundColor: 'black' }}>
                <StatusBar hidden />

                {/* DI WEB KITA PAKE CAMERA VIEW HANYA UTK PREVIEW.
               DI NATIVE KITA PAKAI UTK PREVIEW DAN RECORD.
            */}
                <CameraView style={{ flex: 1 }} facing="front" mode="video" ref={cameraRef}>

                    {isRecording && (
                        <View style={styles.timerOverlay}>
                            <View style={styles.redDot} />
                            <Text style={styles.timerText}>{formatTime(recordTime)}</Text>
                        </View>
                    )}

                    {!isRecording && (
                        <View style={styles.camHeader}>
                            <TouchableOpacity onPress={() => setStep(1)} style={styles.iconBtn}>
                                <Ionicons name="close" size={24} color="white" />
                            </TouchableOpacity>
                            <View style={styles.progressBadge}>
                                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 12 }}>
                                    {currentIndex + 1} / {sentences.length}
                                </Text>
                            </View>
                        </View>
                    )}

                    <View style={[styles.scriptContainer, isRecording && { top: 100 }]}>
                        <View style={styles.scriptBox}>
                            <Text style={styles.scriptLabel}>BACA TEKS:</Text>
                            <Text style={styles.scriptText}>{item?.text || "..."}</Text>
                        </View>
                    </View>

                    <View style={styles.camControls}>
                        {!isRecording ? (
                            <TouchableOpacity onPress={startRecording} style={styles.recordBtnOuter}>
                                <View style={styles.recordBtnInner} />
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity onPress={stopRecording} style={styles.stopBtnOuter}>
                                <View style={styles.stopBtnInner} />
                            </TouchableOpacity>
                        )}
                        <Text style={{ color: 'white', marginTop: 15, fontWeight: '600', letterSpacing: 1 }}>
                            {isRecording ? "TEKAN UNTUK STOP" : "TEKAN UNTUK REKAM"}
                        </Text>
                    </View>
                </CameraView>
            </View>
        );
    }

    // STEP 3: GALERI
    if (step === 3) {
        const pendingCount = queue.filter(q => !q.uploaded).length;
        return (
            <SafeAreaView style={styles.mainContainer}>
                <View style={styles.headerRow}>
                    <TouchableOpacity onPress={() => setStep(1)} style={styles.backBtn}>
                        <Ionicons name="arrow-back" size={24} color="#1e293b" />
                    </TouchableOpacity>
                    <Text style={styles.pageTitle}>Galeri & Upload</Text>

                    {queue.length > 0 ? (
                        <TouchableOpacity onPress={clearAllRecordings} style={{ padding: 10, backgroundColor: '#fee2e2', borderRadius: 12 }}>
                            <Ionicons name="trash" size={20} color="#ef4444" />
                        </TouchableOpacity>
                    ) : (
                        <View style={{ width: 40 }} />
                    )}
                </View>
                <ScrollView style={styles.listContainer}>
                    {queue.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Text style={{ color: '#94a3b8' }}>Belum ada data rekaman.</Text>
                        </View>
                    ) : (
                        queue.slice().reverse().map((item) => (
                            <TouchableOpacity key={item.id} style={[styles.videoCard, item.uploaded && styles.videoCardUploaded]} onPress={() => { setSelectedVideo(item); setPreviewModalVisible(true); }}>
                                <View style={[styles.videoIcon, item.uploaded && { backgroundColor: '#dcfce7' }]}>
                                    <Ionicons name={item.uploaded ? "checkmark" : "play"} size={24} color={item.uploaded ? "#166534" : "#6366f1"} />
                                </View>
                                <View style={{ flex: 1, paddingHorizontal: 12 }}>
                                    <Text style={styles.videoTitle} numberOfLines={1}>{item.text}</Text>
                                    <Text style={styles.videoMeta}>{item.metadata.name} • {new Date(item.date).toLocaleTimeString()}</Text>
                                    {item.uploaded && <Text style={{ color: '#166534', fontSize: 10, fontWeight: 'bold' }}>✅ UPLOADED</Text>}
                                </View>
                                <TouchableOpacity onPress={() => deleteRecording(item.id)} style={{ padding: 10 }}>
                                    <Ionicons name="trash-outline" size={20} color="#ef4444" />
                                </TouchableOpacity>
                            </TouchableOpacity>
                        ))
                    )}
                </ScrollView>

                <View style={styles.footerAction}>
                    {loading ? <ActivityIndicator size="large" color="#6366f1" /> : (
                        <TouchableOpacity style={[styles.btnPrimary, pendingCount === 0 && { backgroundColor: '#94a3b8' }]} onPress={uploadAll} disabled={pendingCount === 0}>
                            <Ionicons name="cloud-upload" size={20} color="white" style={{ marginRight: 8 }} />
                            <Text style={styles.btnTextPrimary}>{pendingCount === 0 ? "Semua Terupload" : `Upload ${pendingCount} Video`}</Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* PREVIEW MODAL */}
                <Modal animationType="slide" transparent={true} visible={previewModalVisible} onRequestClose={() => setPreviewModalVisible(false)}>
                    <View style={styles.modalContainer}>
                        <View style={styles.modalContent}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Preview Rekaman</Text>
                                <TouchableOpacity onPress={() => setPreviewModalVisible(false)}>
                                    <Ionicons name="close" size={28} color="black" />
                                </TouchableOpacity>
                            </View>

                            {/* TAMBAHKAN WRAPPER INI: Kotak hitam statis agar video tidak kebingungan mencari ukuran */}
                            <View style={{ width: '100%', height: Platform.OS === 'web' ? 450 : 400, backgroundColor: 'black', justifyContent: 'center', alignItems: 'center' }}>
                                {selectedVideo && (
                                    <Video
                                        style={{ width: '100%', height: '100%' }}
                                        source={{ uri: selectedVideo.uri }}
                                        useNativeControls
                                        resizeMode={ResizeMode.CONTAIN}
                                        isLooping
                                        shouldPlay
                                    />
                                )}
                            </View>

                            {/* Tampilkan teks di bawah video agar jelas apa yang diucapkan */}
                            {selectedVideo && (
                                <View style={{ padding: 15, backgroundColor: '#f8fafc' }}>
                                    <Text style={{ fontWeight: 'bold', color: '#6366f1', marginBottom: 5 }}>Kalimat:</Text>
                                    <Text style={{ fontSize: 16, color: '#334155' }}>{selectedVideo.text}</Text>
                                </View>
                            )}
                        </View>
                    </View>
                </Modal>
            </SafeAreaView>
        );
    }
}

const styles = StyleSheet.create({
    mainContainer: { flex: 1, backgroundColor: '#f8fafc' },
    header: { padding: 30, paddingTop: 50, alignItems: 'center' },
    logoBadge: { width: 60, height: 60, backgroundColor: '#6366f1', borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
    title: { fontSize: 26, fontWeight: '800', color: '#1e293b' },
    subtitle: { fontSize: 14, color: '#64748b', marginTop: 5 },
    card: { backgroundColor: 'white', marginHorizontal: 24, padding: 24, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 3 },
    label: { fontSize: 12, fontWeight: '700', color: '#94a3b8', marginBottom: 10, textTransform: 'uppercase' },

    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 14, paddingHorizontal: 15, height: 54, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
    inputIcon: { marginRight: 12 },
    input: { flex: 1, fontSize: 16, color: '#1e293b', height: '100%' },
    genderRow: { flexDirection: 'row', gap: 10 },
    genderBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: 'white' },
    genderBtnActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
    genderText: { marginLeft: 8, fontWeight: '600', color: '#64748b' },
    genderTextActive: { color: 'white' },
    btnOutline: { flexDirection: 'row', marginTop: 15, padding: 10, borderWidth: 1, borderColor: '#6366f1', borderRadius: 10, alignItems: 'center' },

    bottomAction: { padding: 24, gap: 12 },
    btnPrimary: { backgroundColor: '#1e293b', height: 56, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
    btnTextPrimary: { color: 'white', fontSize: 16, fontWeight: '700', marginRight: 8 },
    btnSecondary: { backgroundColor: 'white', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
    btnTextSecondary: { color: '#475569', fontSize: 16, fontWeight: '600' },

    timerOverlay: { position: 'absolute', top: 50, alignSelf: 'center', backgroundColor: 'rgba(220, 38, 38, 0.8)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 30, flexDirection: 'row', alignItems: 'center', zIndex: 20 },
    redDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'white', marginRight: 10 },
    timerText: { color: 'white', fontWeight: 'bold', fontSize: 18, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

    camHeader: { position: 'absolute', top: 50, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, alignItems: 'center', zIndex: 10 },
    iconBtn: { padding: 10, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20 },
    progressBadge: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20 },

    scriptContainer: { position: 'absolute', top: 120, left: 20, right: 20 },
    scriptBox: { backgroundColor: 'rgba(255,255,255,0.95)', padding: 24, borderRadius: 20, alignItems: 'center' },
    scriptLabel: { fontSize: 11, fontWeight: '800', color: '#f59e0b', marginBottom: 8, letterSpacing: 1 },
    scriptText: { fontSize: 20, fontWeight: '700', color: '#1e293b', textAlign: 'center', lineHeight: 28 },

    camControls: { position: 'absolute', bottom: 0, width: '100%', alignItems: 'center', paddingBottom: 50, paddingTop: 30 },
    recordBtnOuter: { width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: 'white', justifyContent: 'center', alignItems: 'center' },
    recordBtnInner: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#ef4444' },
    stopBtnOuter: { width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: 'white', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.2)' },
    stopBtnInner: { width: 36, height: 36, borderRadius: 4, backgroundColor: '#ef4444' },

    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 24, paddingTop: 10 },
    pageTitle: { fontSize: 20, fontWeight: '700', color: '#1e293b' },
    backBtn: { padding: 10, backgroundColor: '#e2e8f0', borderRadius: 12 },
    listContainer: { paddingHorizontal: 24 },
    videoCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9' },
    videoCardUploaded: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
    videoIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#e0e7ff', justifyContent: 'center', alignItems: 'center' },
    videoTitle: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 2 },
    videoMeta: { fontSize: 11, color: '#64748b' },
    footerAction: { padding: 24, backgroundColor: 'white', borderTopWidth: 1, borderColor: '#f1f5f9' },
    emptyState: { alignItems: 'center', marginTop: 80 },

    modalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: 'white', borderRadius: 20, overflow: 'hidden', width: '100%', maxWidth: 450, alignSelf: 'center' },
    modalHeader: { padding: 15, flexDirection: 'row', justifyContent: 'space-between' },
    modalTitle: { fontWeight: 'bold' },
    videoPlayer: { width: '100%', height: 300, backgroundColor: 'black' }
});