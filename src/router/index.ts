import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/usecase',
    },
    {
      path: '/usecase',
      name: 'usecase',
      component: () => import('@/views/UseCaseEditor.vue'),
    },
    {
      path: '/er',
      name: 'er',
      component: () => import('@/views/EREditor.vue'),
    },
    {
      path: '/db',
      name: 'db',
      component: () => import('@/views/DBEditor.vue'),
    },
    {
      path: '/func',
      name: 'func',
      component: () => import('@/views/FuncStructEditor.vue'),
    },
    {
      path: '/flow',
      name: 'flow',
      component: () => import('@/views/FlowEditor.vue'),
    },
  ],
})

export default router
