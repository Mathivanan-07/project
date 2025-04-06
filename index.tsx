import React, { useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  Animated,
  Dimensions,
  Modal,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from 'expo-file-system';
import DateTimePicker from "@react-native-community/datetimepicker";
import axios from "axios";
import { MaterialIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";

const { height } = Dimensions.get('window');

type Session = {
  type: 'study' | 'qna' | 'break';
  start_time: string;
  end_time: string;
  duration: number;
};

type MCQ = {
  question: string;
  options: string[];
  correct: string;
};

type Topic = {
  topic_id: number;
  topic: string;
  start_time: string;
  end_time: string;
  allocated_time: number;
  completed: boolean;
  summary: string;
  qna: MCQ[];
  suggested_time?: number;
  sessions?: Session[];
};

type DocumentResult = {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
};

const API_BASE_URL = "http://192.168.66.233:5000/api";

const App: React.FC = () => {
  const [examDate, setExamDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [syllabus, setSyllabus] = useState<DocumentResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [studyPlan, setStudyPlan] = useState<Topic[]>([]);
  const [currentTopicIndex, setCurrentTopicIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showForm, setShowForm] = useState<boolean>(true);
  const [showQnA, setShowQnA] = useState<boolean>(false);
  const [selectedTopicForQnA, setSelectedTopicForQnA] = useState<Topic | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<{[key: number]: string}>({});
  
  const scrollViewRef = useRef<ScrollView>(null);
  const formHeight = useRef(new Animated.Value(300)).current;

  const addLog = (message: string) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    setLogs(prev => [...prev, logMessage].slice(-50));
    console.log(logMessage);
  };

  const pickDocument = async (): Promise<void> => {
    try {
      addLog('Starting document picker');
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        addLog('Document picking canceled by user');
        return;
      }

      const file = result.assets[0];
      addLog(`Selected file: ${file.name} (${file.size} bytes)`);
      
      const fileInfo = await FileSystem.getInfoAsync(file.uri);
      if (!fileInfo.exists) {
        throw new Error('Selected file does not exist');
      }

      setSyllabus({
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
      });
      setError(null);
    } catch (err: any) {
      const errorMsg = `Document picker failed: ${err.message}`;
      addLog(errorMsg);
      setError("Failed to select PDF file");
      Alert.alert("Error", "Failed to select PDF file");
    }
  };

  const processSyllabus = async (): Promise<void> => {
    if (!syllabus) {
      const errorMsg = 'No syllabus PDF selected';
      addLog(errorMsg);
      setError(errorMsg);
      Alert.alert("Error", errorMsg);
      return;
    }

    setLoading(true);
    setError(null);
    addLog('Starting PDF processing...');

    try {
      const fileInfo = await FileSystem.getInfoAsync(syllabus.uri);
      if (!fileInfo.exists) throw new Error('File no longer exists');

      const formData = new FormData();
      formData.append('pdf', {
        uri: syllabus.uri,
        type: syllabus.mimeType || 'application/pdf',
        name: syllabus.name,
      } as any);
      
      const isoDate = examDate.toISOString().split('.')[0] + 'Z';
      formData.append('exam_date', isoDate);

      addLog(`Sending to: ${API_BASE_URL}/process`);
      const response = await axios.post(`${API_BASE_URL}/process`, formData, {
        headers: { 
          'Content-Type': 'multipart/form-data',
          'Accept': 'application/json'
        },
        timeout: 60000,
      });

      console.log("Raw backend data:", JSON.stringify(response.data.schedule, null, 2));
      addLog(`Response received: ${JSON.stringify(response.data)}`);
      
      if (!response.data?.schedule) {
        throw new Error("Invalid response format");
      }

      // Process the schedule to combine study and Q&A sessions
      const transformedPlan = response.data.schedule
        .filter(item => item.topic && item.summary) // Only keep items with proper topics
        .map((item, index) => {
          // Find matching Q&A session if it exists
          const qnaSession = response.data.schedule.find(
            qna => qna.topic_id === item.topic_id && qna.type === "qna"
          );

          return {
            topic_id: index + 1,
            topic: item.topic,
            start_time: item.start_time,
            end_time: qnaSession?.end_time || item.end_time,
            allocated_time: item.allocated_time + (qnaSession?.duration || 0),
            completed: false,
            summary: item.summary,
            qna: item.qna || [],
            suggested_time: item.allocated_time || 30,
            sessions: [
              {
                type: 'study',
                start_time: item.start_time,
                end_time: item.end_time,
                duration: item.allocated_time || 30
              },
              ...(qnaSession ? [{
                type: 'qna',
                start_time: qnaSession.start_time,
                end_time: qnaSession.end_time,
                duration: qnaSession.duration
              }] : [])
            ]
          };
        });

      setStudyPlan(transformedPlan);
      addLog(`Study plan generated with ${transformedPlan.length} topics`);
      
      Animated.timing(formHeight, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }).start(() => {
        setShowForm(false);
        scrollToCurrentTopic();
      });
    } catch (error: any) {
      let errorMessage = "Failed to process syllabus";
      if (axios.isAxiosError(error)) {
        errorMessage = error.response?.data?.error || error.message;
        addLog(`Axios error: ${errorMessage} (Status: ${error.response?.status})`);
      } else {
        errorMessage = error.message || "Unknown error";
        addLog(`Processing error: ${errorMessage}`);
      }
      setError(errorMessage);
      Alert.alert("Processing Error", errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const generateDefaultQnA = (topicName: string): MCQ[] => {
    return [
      {
        question: `What is the main concept of ${topicName}?`,
        options: [
          "a) Option A",
          "b) Option B",
          "c) Option C",
          "d) Option D"
        ],
        correct: "a"
      },
      {
        question: `Why is ${topicName} important?`,
        options: [
          "a) Reason 1",
          "b) Reason 2",
          "c) Reason 3",
          "d) All of the above"
        ],
        correct: "d"
      }
    ];
  };

  const updateTopicTiming = async (topicId: number, actualTime: number) => {
    try {
      addLog(`Updating timing for topic ${topicId} (actual time: ${actualTime} mins)`);
      
      await axios.post(`${API_BASE_URL}/update_timing`, {
        topic_id: topicId,
        minutes: actualTime,
      });

      setStudyPlan(prev => {
        const newPlan = [...prev];
        const topicIndex = newPlan.findIndex(t => t.topic_id === topicId);
        
        if (topicIndex >= 0) {
          const timeSaved = newPlan[topicIndex].allocated_time - actualTime;
          newPlan[topicIndex].allocated_time = actualTime;
          newPlan[topicIndex].completed = true;
          
          if (timeSaved > 0) {
            for (let i = topicIndex + 1; i < newPlan.length; i++) {
              newPlan[i].start_time = addMinutes(newPlan[i].start_time, -timeSaved);
              newPlan[i].end_time = addMinutes(newPlan[i].end_time, -timeSaved);
            }
          }
        }
        return newPlan;
      });

      addLog(`Timing updated successfully for topic ${topicId}`);
    } catch (error: any) {
      const errorMsg = `Failed to update timing: ${error.message}`;
      addLog(errorMsg);
      Alert.alert("Error", "Failed to update study time");
    }
  };

  const completeTopic = (topicId: number) => {
    const topic = studyPlan.find(t => t.topic_id === topicId);
    if (!topic) return;

    Alert.prompt(
      "Completion Time",
      `How many minutes did you spend on "${topic.topic}" (excluding Q&A time)?`,
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        { 
          text: "Submit",
          onPress: (time) => {
            const actualTime = parseInt(time || "0");
            if (actualTime > 0) {
              updateTopicTiming(topicId, actualTime);
            }
          }
        }
      ],
      "plain-text",
      "",
      "numeric"
    );
  };

  const addMinutes = (timeStr: string, minutes: number): string => {
    const [time, period] = timeStr.split(' ');
    const [hour, min] = time.split(':').map(Number);
    let totalMinutes = hour * 60 + min + minutes;
    if (period === 'PM' && hour !== 12) totalMinutes += 720;
    const newHour = Math.floor(totalMinutes / 60) % 12 || 12;
    const newMin = totalMinutes % 60;
    const newPeriod = totalMinutes >= 720 ? 'PM' : 'AM';
    return `${newHour}:${newMin.toString().padStart(2, '0')} ${newPeriod}`;
  };

  const scrollToCurrentTopic = (): void => {
    scrollViewRef.current?.scrollTo({
      y: currentTopicIndex * 220,
      animated: true,
    });
  };

  const handleAnswerSelect = (questionIndex: number, optionKey: string) => {
    setSelectedAnswers(prev => ({
      ...prev,
      [questionIndex]: optionKey
    }));
  };

  const evaluateAnswers = () => {
    if (!selectedTopicForQnA) return;
    
    let score = 0;
    const results = selectedTopicForQnA.qna.map((qna, index) => {
      const isCorrect = selectedAnswers[index] === qna.correct;
      if (isCorrect) score++;
      return {
        question: qna.question,
        correct: qna.correct,
        selected: selectedAnswers[index],
        isCorrect
      };
    });

    Alert.alert(
      "Quiz Results",
      `You scored ${score}/${selectedTopicForQnA.qna.length}`,
      [
        {
          text: "Review Answers",
          onPress: () => showAnswerDetails(results)
        },
        { 
          text: "Continue",
          onPress: () => {
            setShowQnA(false);
            setSelectedAnswers({});
          }
        }
      ]
    );
  };

  const showAnswerDetails = (results: any[]) => {
    let message = "";
    results.forEach((result, index) => {
      message += `Q${index + 1}: ${result.question}\n` +
                 `Your answer: ${result.selected || 'Not answered'}\n` +
                 `Correct answer: ${result.correct}\n\n`;
    });
    Alert.alert("Detailed Results", message);
  };

  const renderTopicCard = (topic: Topic, index: number) => (
    <View
      key={`topic-${topic.topic_id}`}
      style={[
        styles.topicCard,
        index === currentTopicIndex && styles.currentTopic
      ]}
    >
      <Text style={styles.topicTitle}>{topic.topic.replace(/\*\*/g, '')}</Text>
      
      <ScrollView 
        style={styles.summaryScrollContainer}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.summaryText}>
          {topic.summary}
        </Text>
      </ScrollView>
      
      <View style={styles.timeContainer}>
        <MaterialIcons name="schedule" size={16} color="#64748b" />
        <Text style={styles.timeText}>
          {topic.start_time} - {topic.end_time} • {topic.allocated_time} mins
        </Text>
        {topic.sessions && (
          <Text style={styles.sessionBreakdown}>
            (Study: {topic.sessions[0].duration}m • Q&A: {topic.sessions[1]?.duration || 0}m)
          </Text>
        )}
        <View style={styles.quizCountBadge}>
          <Text style={styles.quizCountText}>{topic.qna.length} Qs</Text>
        </View>
      </View>
      
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.viewQnAButton}
          onPress={() => {
            setSelectedTopicForQnA(topic);
            setSelectedAnswers({});
            setShowQnA(true);
          }}
        >
          <Text style={styles.viewQnAButtonText}>Start Quiz</Text>
          <MaterialIcons name="quiz" size={16} color="#6366f1" />
        </TouchableOpacity>
        
        {index === currentTopicIndex && !topic.completed && (
          <TouchableOpacity
            style={styles.completeButton}
            onPress={() => completeTopic(topic.topic_id)}
          >
            <Text style={styles.completeButtonText}>Mark Completed</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderQnAModal = () => (
    <Modal
      visible={showQnA}
      animationType="slide"
      onRequestClose={() => setShowQnA(false)}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{selectedTopicForQnA?.topic} Quiz</Text>
          <TouchableOpacity onPress={() => setShowQnA(false)}>
            <MaterialIcons name="close" size={24} color="#6366f1" />
          </TouchableOpacity>
        </View>
        
        <ScrollView style={styles.qnaScrollContainer}>
          <ScrollView 
            style={styles.modalSummaryScroll}
            nestedScrollEnabled
          >
            <Text style={styles.summaryText}>
              {selectedTopicForQnA?.summary}
            </Text>
          </ScrollView>
          
          <Text style={styles.quizSectionTitle}>Test Your Knowledge</Text>
          
          {selectedTopicForQnA?.qna?.map((qna, index) => (
            <View key={`qna-${index}`} style={styles.questionContainer}>
              <Text style={styles.questionText}>
                Q{index + 1}: {qna.question}
              </Text>
              
              {qna.options.map((option, optIndex) => {
                const optionKey = option[0].toLowerCase();
                return (
                  <TouchableOpacity
                    key={`opt-${optIndex}`}
                    style={[
                      styles.optionButton,
                      selectedAnswers[index] === optionKey && styles.selectedOption
                    ]}
                    onPress={() => handleAnswerSelect(index, optionKey)}
                  >
                    <Text style={styles.optionText}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </ScrollView>
        
        <TouchableOpacity
          style={[
            styles.evaluateButton,
            Object.keys(selectedAnswers).length < (selectedTopicForQnA?.qna.length || 0) && 
              styles.evaluateButtonDisabled
          ]}
          onPress={evaluateAnswers}
          disabled={Object.keys(selectedAnswers).length < (selectedTopicForQnA?.qna.length || 0)}
        >
          <Text style={styles.evaluateButtonText}>Evaluate Answers</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      
      <View style={styles.header}>
        <Text style={styles.headerText}>Study Planner</Text>
        {!showForm && (
          <TouchableOpacity onPress={() => setShowForm(true)}>
            <MaterialIcons name="settings" size={24} color="white" />
          </TouchableOpacity>
        )}
      </View>

      {error && (
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={20} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity 
        style={styles.debugButton}
        onPress={() => Alert.alert("Recent Logs", logs.join('\n'))}
      >
        <MaterialIcons name="bug-report" size={20} color="#6366f1" />
      </TouchableOpacity>

      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.scrollContent}>
        <Animated.View style={[styles.formContainer, { height: showForm ? formHeight : 0 }]}>
          <View style={styles.card}>
            <TouchableOpacity style={styles.uploadButton} onPress={pickDocument}>
              <MaterialIcons name="upload-file" size={20} color="white" />
              <Text style={styles.buttonText}>Select PDF</Text>
            </TouchableOpacity>
            {syllabus && (
              <Text style={styles.fileName} numberOfLines={1}>{syllabus.name}</Text>
            )}
          </View>

          <View style={styles.card}>
            <TouchableOpacity 
              style={styles.dateButton}
              onPress={() => setShowDatePicker(true)}
            >
              <MaterialIcons name="event" size={20} color="white" />
              <Text style={styles.buttonText}>
                {examDate.toLocaleDateString()}
              </Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={examDate}
                mode="date"
                display="compact"
                onChange={(event, date) => {
                  if (date) setExamDate(date);
                  setShowDatePicker(false);
                }}
              />
            )}
          </View>

          <TouchableOpacity 
            style={[styles.generateButton, (loading || !syllabus) && styles.disabledButton]}
            onPress={processSyllabus}
            disabled={loading || !syllabus}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <MaterialIcons name="auto-awesome" size={20} color="white" />
                <Text style={styles.buttonText}>Generate Plan</Text>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        {studyPlan.length > 0 && (
          <View style={styles.planContainer}>
            <Text style={styles.planTitle}>Your Study Plan</Text>
            
            {studyPlan.map((topic, index) => renderTopicCard(topic, index))}

            <View style={styles.navControls}>
              <TouchableOpacity
                style={[styles.navButton, currentTopicIndex === 0 && styles.disabledNavButton]}
                onPress={() => {
                  if (currentTopicIndex > 0) {
                    setCurrentTopicIndex(prev => prev - 1);
                    scrollToCurrentTopic();
                  }
                }}
                disabled={currentTopicIndex === 0}
              >
                <MaterialIcons name="chevron-left" size={20} color="white" />
                <Text style={styles.navButtonText}>Previous</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.navButton}
                onPress={() => {
                  if (currentTopicIndex < studyPlan.length - 1) {
                    setCurrentTopicIndex(prev => prev + 1);
                    scrollToCurrentTopic();
                  } else {
                    Alert.alert("🎉 Complete!", "You've finished all topics!");
                  }
                }}
              >
                <Text style={styles.navButtonText}>
                  {currentTopicIndex === studyPlan.length - 1 ? "Finish" : "Next"}
                </Text>
                <MaterialIcons name="chevron-right" size={20} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
      
      {renderQnAModal()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    backgroundColor: '#6366f1',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    color: 'white',
    fontSize: 22,
    fontWeight: '700',
  },
  formContainer: {
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  uploadButton: {
    flexDirection: 'row',
    backgroundColor: '#6366f1',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  dateButton: {
    flexDirection: 'row',
    backgroundColor: '#10b981',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateButton: {
    flexDirection: 'row',
    backgroundColor: '#f59e0b',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  fileName: {
    marginTop: 8,
    color: '#475569',
    fontSize: 14,
    textAlign: 'center',
  },
  planContainer: {
    padding: 16,
  },
  planTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 20,
    textAlign: 'center',
  },
  topicCard: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 10,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#e2e8f0',
    minHeight: 220,
  },
  currentTopic: {
    borderLeftColor: '#6366f1',
    backgroundColor: '#eef2ff',
  },
  topicTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 8,
  },
  summaryScrollContainer: {
    maxHeight: 150,
    marginVertical: 8,
  },
  summaryText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  timeText: {
    marginLeft: 6,
    color: '#64748b',
    fontSize: 14,
  },
  sessionBreakdown: {
    fontSize: 12,
    color: '#64748b',
    marginLeft: 8,
    fontStyle: 'italic',
  },
  quizCountBadge: {
    backgroundColor: '#ddd6fe',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  quizCountText: {
    color: '#5b21b6',
    fontSize: 12,
    fontWeight: '500',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewQnAButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e0e7ff',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    marginTop: 8,
  },
  viewQnAButtonText: {
    color: '#4f46e5',
    fontWeight: '500',
    marginRight: 6,
  },
  completeButton: {
    backgroundColor: '#10b981',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    marginTop: 8,
  },
  completeButtonText: {
    color: 'white',
    fontWeight: '500',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'white',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
  },
  qnaScrollContainer: {
    flex: 1,
    padding: 16,
  },
  modalSummaryScroll: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    maxHeight: 200,
  },
  quizSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 12,
  },
  questionContainer: {
    marginBottom: 16,
  },
  questionText: {
    fontWeight: '500',
    color: '#1e293b',
    marginBottom: 8,
    fontSize: 15,
  },
  optionButton: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 6,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  selectedOption: {
    backgroundColor: '#e0e7ff',
    borderColor: '#6366f1',
  },
  optionText: {
    color: '#1e293b',
  },
  evaluateButton: {
    backgroundColor: '#6366f1',
    padding: 16,
    margin: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  evaluateButtonDisabled: {
    backgroundColor: '#c7d2fe',
  },
  evaluateButtonText: {
    color: 'white',
    fontWeight: '500',
    fontSize: 16,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    padding: 12,
    marginHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
  },
  errorText: {
    color: '#ef4444',
    marginLeft: 8,
  },
  debugButton: {
    position: 'absolute',
    right: 20,
    top: 70,
    zIndex: 10,
    backgroundColor: 'white',
    padding: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  navControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 12,
  },
  navButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#6366f1',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledNavButton: {
    opacity: 0.5,
  },
  navButtonText: {
    color: 'white',
    fontWeight: '500',
    marginHorizontal: 8,
  },
});

export default App;