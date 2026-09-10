import blog from './blog.dbml?raw'

export interface Example {
  id: string
  title: string
  description: string
  dbml: string
}

/** OWNER: worker-6 (app). Add more examples here (e-commerce, school, saas, django-auth). */
export const examples: Example[] = [
  { id: 'blog', title: 'Blog', description: 'Users, posts, tags, comments with an enum and a many-to-many.', dbml: blog },
]
