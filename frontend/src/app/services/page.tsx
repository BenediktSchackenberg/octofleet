'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ServiceClass {
  id: string;
  name: string;
  description: string;
  service_type: string;
  min_nodes: number;
  max_nodes: number;
  service_count: number;
}

interface Service {
  id: string;
  name: string;
  description: string;
  class_name: string;
  status: string;
  active_nodes: number;
  created_at: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.0.5:8080';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || 'openclaw-inventory-dev-key';

const statusColors: Record<string, string> = {
  provisioning: 'bg-yellow-100 text-yellow-800',
  healthy: 'bg-green-100 text-green-800',
  degraded: 'bg-orange-100 text-orange-800',
  failed: 'bg-red-100 text-red-800',
  stopped: 'bg-gray-100 text-gray-800',
};

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [serviceClasses, setServiceClasses] = useState<ServiceClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'services' | 'classes'>('services');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateClassModal, setShowCreateClassModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [servicesRes, classesRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/services`, { headers: { 'X-API-Key': API_KEY } }),
        fetch(`${API_URL}/api/v1/service-classes`, { headers: { 'X-API-Key': API_KEY } }),
      ]);
      
      const servicesData = await servicesRes.json();
      const classesData = await classesRes.json();
      
      setServices(servicesData.services || []);
      setServiceClasses(classesData.serviceClasses || []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Service Orchestration</h1>
          <p className="text-gray-500">Manage services and service templates</p>
        </div>
        <div className="space-x-2">
          {activeTab === 'services' ? (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Service
            </button>
          ) : (
            <button
              onClick={() => setShowCreateClassModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Template
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b mb-6">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('services')}
            className={`py-2 px-1 border-b-2 font-medium ${
              activeTab === 'services'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Services ({services.length})
          </button>
          <button
            onClick={() => setActiveTab('classes')}
            className={`py-2 px-1 border-b-2 font-medium ${
              activeTab === 'classes'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Templates ({serviceClasses.length})
          </button>
        </nav>
      </div>

      {/* Services Tab */}
      {activeTab === 'services' && (
        <div className="grid gap-4">
          {services.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <p className="text-gray-500 mb-4">No services configured yet</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-blue-600 hover:underline"
              >
                Create your first service →
              </button>
            </div>
          ) : (
            services.map((service) => (
              <Link
                key={service.id}
                href={`/services/${service.id}`}
                className="block bg-white rounded-lg border p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-lg">{service.name}</h3>
                    <p className="text-gray-500 text-sm">{service.description || 'No description'}</p>
                    <p className="text-gray-400 text-xs mt-1">Template: {service.class_name}</p>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[service.status] || 'bg-gray-100'}`}>
                      {service.status}
                    </span>
                    <p className="text-gray-500 text-sm mt-2">
                      {service.active_nodes} node{service.active_nodes !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      )}

      {/* Service Classes Tab */}
      {activeTab === 'classes' && (
        <div className="grid gap-4 md:grid-cols-2">
          {serviceClasses.length === 0 ? (
            <div className="col-span-2 text-center py-12 bg-gray-50 rounded-lg">
              <p className="text-gray-500 mb-4">No service templates yet</p>
              <button
                onClick={() => setShowCreateClassModal(true)}
                className="text-blue-600 hover:underline"
              >
                Create your first template →
              </button>
            </div>
          ) : (
            serviceClasses.map((sc) => (
              <div
                key={sc.id}
                className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold">{sc.name}</h3>
                    <p className="text-gray-500 text-sm">{sc.description || 'No description'}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    sc.service_type === 'cluster' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {sc.service_type}
                  </span>
                </div>
                <div className="mt-3 flex items-center text-sm text-gray-500">
                  <span>Nodes: {sc.min_nodes}-{sc.max_nodes}</span>
                  <span className="mx-2">•</span>
                  <span>{sc.service_count} service{sc.service_count !== 1 ? 's' : ''} using this</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Create Service Modal */}
      {showCreateModal && (
        <CreateServiceModal
          serviceClasses={serviceClasses}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            fetchData();
          }}
        />
      )}

      {/* Create Class Modal */}
      {showCreateClassModal && (
        <CreateClassModal
          onClose={() => setShowCreateClassModal(false)}
          onCreated={() => {
            setShowCreateClassModal(false);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

function CreateServiceModal({
  serviceClasses,
  onClose,
  onCreated,
}: {
  serviceClasses: ServiceClass[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [classId, setClassId] = useState(serviceClasses[0]?.id || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const res = await fetch(`${API_URL}/api/v1/services`, {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, classId }),
      });
      
      if (res.ok) {
        onCreated();
      } else {
        alert('Failed to create service');
      }
    } catch (error) {
      alert('Error creating service');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Create Service</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Template</label>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="w-full border rounded-lg p-2"
              required
            >
              {serviceClasses.map((sc) => (
                <option key={sc.id} value={sc.id}>{sc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded-lg p-2"
              placeholder="my-web-service"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border rounded-lg p-2"
              placeholder="Optional description..."
              rows={2}
            />
          </div>
          <div className="flex justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !classId}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateClassModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [serviceType, setServiceType] = useState('single');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const res = await fetch(`${API_URL}/api/v1/service-classes`, {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, serviceType }),
      });
      
      if (res.ok) {
        onCreated();
      } else {
        alert('Failed to create template');
      }
    } catch (error) {
      alert('Error creating template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Create Service Template</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded-lg p-2"
              placeholder="nginx-webserver"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              className="w-full border rounded-lg p-2"
            >
              <option value="single">Single Node</option>
              <option value="cluster">Cluster</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border rounded-lg p-2"
              placeholder="What this service template provides..."
              rows={2}
            />
          </div>
          <div className="flex justify-end space-x-2 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
