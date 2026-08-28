//type check environment variables
/*
    Custom env is a library built to make development more feasible by allowing multiple .env configurations for different environments. This is done by loading environment variables from a .env.envname file, into the node's process.env object.
*/
/*
    Zod is a TypeScript-first validation library. Define a schema and parse some data with it. You'll get back a strongly typed, validated result.
*/
// @ts-ignore
import {env as loadEnv} from 'custom-env';
import { z } from 'zod';

/*
    This line sets up a default value for the APP_STAGE environment variable using a common JavaScript pattern called "short-circuit evaluation" or the "OR operator default pattern". It ensures that APP_STAGE always has a value, even if it wasn't defined in your environment configuration.

    The expression process.env.APP_STAGE || 'dev' works by checking if process.env.APP_STAGE already has a truthy value. If APP_STAGE was defined in your .env file or system environment variables, it will use that existing value. However, if APP_STAGE is undefined, null, an empty string, or any other falsy value, the OR operator (||) will "short-circuit" and use the fallback value 'dev' instead.
*/
//process.env.APP_STAGE = process.env.APP_STAGE || 'dev';

/*
    process is a global object in Node.js, not a regular variable. It's automatically available in every Node.js application without needing to import it.

    The process object provides information about, and control over, the current Node.js process. It represents the running instance of your Node.js application. Think of it as a bridge between your JavaScript code and the underlying operating system.
*/



// Solo para decidir qué .env cargar; no modifica process.env.APP_STAGE
const currentStage = process.env.APP_STAGE || 'dev';

if (currentStage === 'dev') {
    loadEnv();
} else if (currentStage === 'test') {
    loadEnv('test');
}

/*
    This code defines a schema for environment variables using Zod, a TypeScript-first validation library. The schema acts as a blueprint that describes what your environment variables should look like and what values they're allowed to have.

    The envSchema constant creates a Zod object schema using z.object(), which is similar to defining a TypeScript interface but with runtime validation capabilities. Inside this schema, you're defining a single environment variable called NODE_ENV.

    The z.enum() validator specifies that NODE_ENV must be one of three exact string values: 'production', 'dev', or 'test'. This is more restrictive than a regular string type - it ensures that NODE_ENV can only be set to these specific values, preventing typos or invalid environment names. If someone tries to use 'development' or 'staging', for example, Zod will throw a validation error.

    This schema is typically used in conjunction with envSchema.parse() or envSchema.safeParse() to validate your actual environment variables at runtime. This gives you type safety for your configuration - TypeScript knows the exact types, and Zod ensures the values are correct when your application starts. It's a common pattern in modern TypeScript applications to catch configuration errors early rather than discovering them deep in your code execution.
*/
const envSchema = z.object({
    NODE_ENV: z
        .enum(['production', 'dev', 'test'])
        .default('dev'),
    
    APP_STAGE: z
        .enum(['production', 'dev', 'test']),
        
    
    PORT: z.coerce.number().positive().default(3000),

    DATABASE_URL: z.string().startsWith('postgresql://'),

    JWT_SECRET: z.string().min(12, 'JWT_SECRET must be at least 12 characters long'),
    JWT_EXPIRES_IN: z.string().default('1h'),

    BCRYPT_ROUNDS: z.coerce.number().positive().min(1).max(20).default(12),

SMTP_HOST: z.string(),
SMTP_PORT: z.coerce.number().positive().default(587),
SMTP_SECURE: z.coerce.boolean().default(false),
SMTP_USER: z.string(),
SMTP_PASSWORD: z.string(),
SMTP_FROM: z.string(),

});

/*
    This line creates and exports a TypeScript type called Env that represents the validated structure of your environment variables. It uses Zod's z.infer utility to automatically generate a TypeScript type from the envSchema you defined earlier.

    The z.infer<typeof envSchema> part is doing something clever: it extracts the TypeScript type from your Zod schema. Instead of manually writing out a TypeScript interface that matches your schema (which would be error-prone and require duplicating your validation logic), Zod automatically derives the type for you. In this case, based on your schema with NODE_ENV: z.enum(['production', 'dev', 'test']), the inferred type would be equivalent to { NODE_ENV: 'production' | 'dev' | 'test' }.

    By exporting this type, you make it available throughout your application. Other files can import Env and use it for type annotations, function parameters, or return types. This ensures that everywhere you reference environment variables in your code, TypeScript knows exactly what properties exist and what values they can have. It creates a single source of truth - your Zod schema defines both the runtime validation rules and the compile-time TypeScript types, keeping them perfectly synchronized.
*/
export type Env = z.infer<typeof envSchema>;

let env: Env;

try{
    env = envSchema.parse(process.env);
}catch (error) {
    if (error instanceof z.ZodError) {
        const failedFields = error.issues.map((err) => err.path.join('.'));
        console.error('Environment variable validation failed for:', failedFields.join(', '));

        error.issues.forEach((err) => {
            const path = err.path.join('.');
            console.error(`- ${path}: ${err.message}`);
        });
        
        //stop the application if env validation fails
        process.exit(1);
    }

    throw error;
}

export const isProd = ()=> env.APP_STAGE === 'production';
export const isDev = ()=> env.APP_STAGE === 'dev';
export const isTest = ()=> env.APP_STAGE === 'test';


export default env;