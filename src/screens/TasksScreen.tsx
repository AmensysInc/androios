import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';

export default function TasksScreen() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      const raw = await api.getCalendarEvents({
        user: user?.id,
        event_type: 'task',
        start_time__gte: monthStart.toISOString(),
        end_time__lte: monthEnd.toISOString(),
      });
      setTasks(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const addTask = async () => {
    const title = newTitle.trim();
    if (!title) {
      Alert.alert('Validation', 'Enter a title');
      return;
    }
    setSaving(true);
    try {
      const start = new Date();
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      await api.createCalendarEvent({
        title,
        event_type: 'task',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        user: user?.id,
      });
      setNewTitle('');
      setModalOpen(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  const toggleComplete = async (task: any) => {
    try {
      await api.updateCalendarEvent(task.id, { completed: !task.completed });
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update');
    }
  };

  const deleteTask = (task: any) => {
    Alert.alert('Delete', `Delete "${task.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteCalendarEvent(task.id);
            load();
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Failed to delete');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tasks</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => setModalOpen(true)}>
          <Text style={styles.primaryButtonText}>+ Add task</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No tasks this month</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <TouchableOpacity style={styles.checkRow} onPress={() => toggleComplete(item)}>
              <View style={[styles.checkbox, item.completed && styles.checkboxDone]}>
                {item.completed && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={[styles.taskTitle, item.completed && styles.taskTitleDone]} numberOfLines={1}>{item.title}</Text>
            </TouchableOpacity>
            <Text style={styles.taskDate}>
              {item.start_time ? new Date(item.start_time).toLocaleDateString([], { dateStyle: 'short' }) : ''}
            </Text>
            <TouchableOpacity onPress={() => deleteTask(item)}>
              <Text style={styles.danger}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      />
      <Modal visible={modalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>New task</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Task title"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setModalOpen(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButton, saving && styles.disabled]} onPress={addTask} disabled={saving}>
                <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  primaryButton: { marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: '#3b82f6', alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '600' },
  listContent: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  checkRow: { flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#3b82f6', marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  checkMark: { color: '#fff', fontWeight: '700' },
  taskTitle: { flex: 1, fontSize: 15, color: '#0f172a' },
  taskTitleDone: { textDecorationLine: 'line-through', color: '#64748b' },
  taskDate: { fontSize: 12, color: '#64748b', marginTop: 6 },
  danger: { color: '#ef4444', fontSize: 13, marginTop: 8 },
  empty: { padding: 24, textAlign: 'center', color: '#64748b' },
  disabled: { opacity: 0.7 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalBox: { backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 16 },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center' },
  cancelButtonText: { color: '#64748b', fontWeight: '600' },
});
